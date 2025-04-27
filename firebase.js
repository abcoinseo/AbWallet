// @ts-check // Enables type checking in VS Code, optional but helpful

document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration ---
    // WARNING: Ensure your Firebase project has appropriate (SECURE!) security rules for production.
    // The rules required for THIS CLIENT-SIDE DEMO to function are INSECURE.
    const firebaseConfig = {
        apiKey: "AIzaSyBW1WPXUN8DYhT6npZQYoQ3l4J-jFSbzfg", // SECURE VIA RULES/BACKEND
        authDomain: "ab-studio-marketcap.firebaseapp.com",
        databaseURL: "https://ab-studio-marketcap-default-rtdb.firebaseio.com",
        projectId: "ab-studio-marketcap",
        storageBucket: "ab-studio-marketcap.firebasestorage.app",
        messagingSenderId: "115268088088",
        appId: "1:115268088088:web:65643a047f92bfaa66ee6d"
    };

    // --- Constants ---
    const SWAP_FEE_PERCENT = 0.1; // 0.1% swap fee
    const DEBOUNCE_DELAY = 300; // Delay for input calculations (ms)
    const PRECISION = 8; // Decimal places for storing non-USD balances
    const RECENT_TRANSACTIONS_LIMIT = 15; // Max transactions to show on home page

    // --- Globals ---
    const tg = window.Telegram.WebApp;
    /** @type {any | null} Current Telegram User object */
    let currentUser = null;
    /** @type {Object.<string, number>} User's token balances (e.g., { USD: 100, ABT: 50 }) */
    let userBalances = {};
    /** @type {Object.<string, {name: string, symbol: string, priceUSD: number, logoUrl: string}>} Available token definitions */
    let availableTokens = {};
    /** @type {firebase.app.App | null} Firebase App instance */
    let firebaseApp = null;
    /** @type {firebase.database.Database | null} Firebase Database instance */
    let db = null;
    /** @type {firebase.database.Reference | null} Reference to the current user's data in Firebase */
    let userDbRef = null;
     /** @type {firebase.database.Reference | null} Reference to user's transactions */
    let userTransactionsRef = null;
    /** @type {boolean} Flag to prevent attaching multiple balance listeners */
    let balanceListenerAttached = false;
    /** @type {Function | null} Detacher function for transaction listener */
    let transactionListenerDetacher = null; // Optional live listener

    // Swap state
    let swapState = {
        fromToken: null, // symbol e.g., 'USD'
        toToken: null,   // symbol e.g., 'ABT'
        fromAmount: 0,
        toAmount: 0,     // Estimated amount after fees
        rate: 0,         // Base rate before fees
        isRateLoading: false
    };
    /** @type {'from' | 'to' | null} Indicates which token selector modal is active */
    let activeTokenSelector = null;

    // --- DOM Element References ---
    // Cache all necessary DOM elements for performance and cleaner code
    const elements = {
        loadingOverlay: document.getElementById('loading-overlay'),
        mainContent: document.getElementById('main-content'),
        pages: document.querySelectorAll('.page'),
        navButtons: document.querySelectorAll('#bottom-nav .nav-button'),
        backButtons: document.querySelectorAll('.back-button'),
        refreshButton: document.getElementById('refresh-button'),
        // Home
        userInfoDisplay: document.getElementById('user-info-display'),
        totalBalanceDisplay: document.getElementById('total-balance-display'),
        assetListContainer: document.getElementById('asset-list'),
        transactionListContainer: document.getElementById('transaction-list'),
        // Receive (Deposit) Page
        depositChatIdSpan: document.getElementById('deposit-chat-id'),
        // Send (Withdraw) Page
        withdrawAssetSelect: document.getElementById('withdraw-asset-select'),
        withdrawAvailableBalance: document.getElementById('withdraw-available-balance'),
        withdrawRecipientIdInput: document.getElementById('withdraw-recipient-id'),
        withdrawAmountInput: document.getElementById('withdraw-amount'),
        sendButton: document.getElementById('send-button'),
        withdrawMaxButton: document.getElementById('withdraw-max-button'),
        withdrawStatus: document.getElementById('withdraw-status'),
        // Swap Page
        swapFromAmountInput: document.getElementById('swap-from-amount'),
        swapToAmountInput: document.getElementById('swap-to-amount'),
        swapFromTokenButton: document.getElementById('swap-from-token-button'),
        swapToTokenButton: document.getElementById('swap-to-token-button'),
        swapFromBalance: document.getElementById('swap-from-balance'),
        swapToBalance: document.getElementById('swap-to-balance'),
        swapSwitchButton: document.getElementById('swap-switch-button'),
        swapRateDisplay: document.getElementById('swap-rate-display'),
        executeSwapButton: document.getElementById('execute-swap-button'),
        swapStatus: document.getElementById('swap-status'),
        // Token Modal
        tokenModal: document.getElementById('token-selector-modal'),
        tokenSearchInput: document.getElementById('token-search-input'),
        tokenListModal: document.getElementById('token-list-modal'),
        closeModalButton: document.getElementById('token-selector-modal')?.querySelector('.close-modal-button'),
    };

    // --- Utility Functions ---

    /** Formats a number as USD currency string (e.g., "$1,234.56"). */
    const formatCurrency = (amount) => {
        const num = parseFloat(amount) || 0;
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
    };

    /** Formats a token amount with appropriate decimal places for display. */
    const formatTokenAmount = (amount, decimals = 6) => {
         const num = parseFloat(amount) || 0;
         const effectiveDecimals = num !== 0 && Math.abs(num) < 0.01 ? Math.max(decimals, 4) : (Math.abs(num) > 10000 ? 2 : decimals);
         return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: effectiveDecimals });
    };

    /** Parses a value to a float, defaulting to 0. */
    const sanitizeFloat = (value) => parseFloat(String(value)) || 0;

    /** Parses a value to an integer, defaulting to 0. */
    const sanitizeInt = (value) => parseInt(String(value), 10) || 0;

    /** Debounce utility to delay function execution. */
    const debounce = (func, delay) => {
        let timeoutId;
        return function(...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                func.apply(this, args);
            }, delay);
        };
    };

    /** Formats a Firebase timestamp into a user-friendly relative or absolute date/time string. */
    const formatTimestamp = (timestamp) => {
        if (!timestamp || typeof timestamp !== 'number') return 'Unknown date';
        const now = new Date();
        const date = new Date(timestamp);
        const diffSeconds = Math.round((now.getTime() - date.getTime()) / 1000);

        if (diffSeconds < 5) return 'Just now';
        if (diffSeconds < 60) return `${diffSeconds}s ago`;
        if (diffSeconds < 3600) return `${Math.round(diffSeconds / 60)}m ago`; // Minutes
        if (diffSeconds < 86400) return `${Math.round(diffSeconds / 3600)}h ago`; // Hours
        if (diffSeconds < 604800) return `${Math.round(diffSeconds / 86400)}d ago`; // Days (up to a week)

        const options = { month: 'short', day: 'numeric' };
        if (date.getFullYear() !== now.getFullYear()) { options.year = 'numeric'; }
        return date.toLocaleDateString(undefined, options);
    };

    // --- Loading & Alerts ---

    /** Shows the loading overlay with an optional message. */
    function showLoading(message = "Processing...") {
        if (!elements.loadingOverlay) return;
        elements.loadingOverlay.querySelector('p').textContent = message;
        elements.loadingOverlay.classList.add('visible');
    }

    /** Hides the loading overlay. */
    function hideLoading() {
        if (elements.loadingOverlay) elements.loadingOverlay.classList.remove('visible');
    }

    /** Displays an alert using the Telegram WebApp interface or a standard alert. */
    function showTgAlert(message, title = 'Alert') {
        const fullMessage = `${title}: ${message}`;
        if (tg?.showAlert) { tg.showAlert(fullMessage); }
        else { alert(fullMessage); console.warn("Fallback alert used."); }
    }

    /** Handles and reports Firebase errors. */
    function handleFirebaseError(error, context = "Firebase Operation") {
        console.error(`${context} Error:`, error.code, error.message);
        hideLoading();
        let userMessage = `Operation failed. ${error.message || 'Please try again.'}`;
        if (error.code === 'PERMISSION_DENIED') { userMessage = "Action not allowed. Check permissions or contact support."; }
        else if (error.code === 'NETWORK_ERROR' || error.message?.includes('network error')) { userMessage = "Network error. Check connection."; }
        showTgAlert(userMessage, `Error: ${context}`);
    }

    // --- Navigation & Page Handling ---

    /** Switches the visible page in the UI. */
    function showPage(pageId) {
        console.log(`Navigating to: ${pageId}`);
        let pageFound = false;
        elements.pages.forEach(page => {
             const isActive = page.id === pageId;
             page.classList.toggle('active', isActive);
             if(isActive) pageFound = true;
        });
        if (!pageFound) { pageId = 'home-page'; elements.pages[0]?.classList.add('active'); console.warn("Invalid page ID, defaulting to home."); }
        elements.navButtons.forEach(button => button.classList.toggle('active', button.dataset.page === pageId));
        if (elements.mainContent) elements.mainContent.scrollTop = 0;

        // Call page-specific setup functions AFTER page is visible
        switch (pageId) {
            case 'home-page': updateHomePageUI(); fetchAndDisplayTransactions(); break;
            case 'swap-page': setupSwapPage(); break;
            case 'deposit-page': setupReceivePage(); break;
            case 'withdraw-page': setupSendPage(); break;
        }
    }

    // --- Core Data Handling & UI Updates ---

    /** Fetches token definitions from Firebase. Crucial for selectors and pricing. */
    async function fetchAvailableTokens() {
        if (!db) { throw new Error("Database not initialized for fetchAvailableTokens."); }
        console.log("Fetching token definitions...");
        try {
            const snapshot = await db.ref('tokens').once('value');
            availableTokens = snapshot.val() || {};
            if (Object.keys(availableTokens).length === 0) { console.warn("No token definitions found in Firebase."); }
            else { console.log(`Loaded ${Object.keys(availableTokens).length} tokens.`); }
        } catch (error) { handleFirebaseError(error, "fetching token list"); availableTokens = {}; }
    }

    /** Updates the Home page portfolio section. */
    function updateHomePageUI() {
        if (!elements.assetListContainer || !elements.totalBalanceDisplay) return;
        console.log("Updating Home Portfolio UI");
        let totalValueUSD = 0;
        elements.assetListContainer.innerHTML = '';

        const heldSymbols = Object.keys(userBalances)
            .filter(symbol => userBalances[symbol] > 0.0000001 && availableTokens[symbol])
            .sort((a, b) => { /* Sort by value */ });

        if (heldSymbols.length === 0) {
            elements.assetListContainer.innerHTML = '<p class="no-assets placeholder-text">No assets held.</p>';
        } else {
            heldSymbols.forEach(symbol => { /* ... create and append asset card (same as before) ... */ });
        }
        elements.totalBalanceDisplay.textContent = totalValueUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    /** Displays the current user's Telegram profile info. */
    function displayUserInfo() { /* ... (same as before) ... */ }

    /** Sets up the Receive page UI with the user's Chat ID. */
    function setupReceivePage() { /* ... (same as before) ... */ }

    // --- Transaction History ---

    /** Fetches and displays recent transactions on the Home page. */
    async function fetchAndDisplayTransactions(limit = RECENT_TRANSACTIONS_LIMIT) {
        if (!userTransactionsRef || !elements.transactionListContainer) return;
        console.log(`Fetching last ${limit} transactions...`);
        elements.transactionListContainer.innerHTML = '<p class="placeholder-text">Loading transactions...</p>';

        try {
            const snapshot = await userTransactionsRef.orderByChild('timestamp').limitToLast(limit).once('value');
            const transactionsData = snapshot.val();

            if (!transactionsData || Object.keys(transactionsData).length === 0) {
                elements.transactionListContainer.innerHTML = '<p class="no-transactions placeholder-text">No recent transactions.</p>';
                return;
            }
            elements.transactionListContainer.innerHTML = '';

            const sortedTx = Object.entries(transactionsData)
                                .map(([id, data]) => ({ id, ...data }))
                                .sort((a, b) => b.timestamp - a.timestamp);

            sortedTx.forEach(tx => {
                const txElement = createTransactionElement(tx);
                elements.transactionListContainer.appendChild(txElement);
            });
        } catch (error) { handleFirebaseError(error, "fetching transactions"); /* Show error in list */ }
    }

    /** Creates an HTML element for a single transaction item. */
    function createTransactionElement(tx) { /* ... (same as before, generates HTML for a tx row) ... */ }

    // --- Firebase Realtime Listeners ---

    /** Sets up the listener for realtime balance updates. */
    function setupBalanceListener() {
        if (!userDbRef || balanceListenerAttached) {
             if (!userDbRef) console.error("Cannot attach balance listener: userDbRef is null.");
             return;
        }
        console.log("Setting up Firebase balance listener...");
        const balancesRef = userDbRef.child('balances');

        balancesRef.on('value', (snapshot) => {
            userBalances = snapshot.val() || {};
            console.log("Realtime balances update received:", userBalances);
            // Update UI based on the currently active page
            const activePageId = document.querySelector('.page.active')?.id;
             if(activePageId) {
                 switch(activePageId) {
                    case 'home-page': updateHomePageUI(); break; // Update portfolio on home
                    case 'swap-page': updateSwapBalancesUI(); validateSwapInput(); break; // Update swap balances/validation
                    case 'withdraw-page': updateWithdrawPageBalance(); break; // Update send balance/validation
                 }
             }
        }, (error) => { handleFirebaseError(error, "listening to balance changes"); balanceListenerAttached = false; });
        balanceListenerAttached = true;
    }

    /** (Optional) Sets up a listener for new transactions. */
    function setupTransactionListener() { /* ... (Optional live TX listener logic) ... */ }

    // --- Firebase Initialization and User Setup ---

    /** Initializes Firebase, fetches tokens, loads/creates user, sets listeners. */
    async function initializeFirebaseAndUser() {
        if (!currentUser?.id || !db) { throw new Error("Cannot initialize Firebase data: Missing user ID or DB instance."); }
        console.log(`Initializing data for user: ${currentUser.id}`);
        const userId = currentUser.id.toString();
        userDbRef = db.ref('users/' + userId);
        userTransactionsRef = db.ref('transactions/' + userId); // Set ref for transactions

        try {
            // Fetch/Create user profile and balances
            const snapshot = await userDbRef.once('value');
            if (!snapshot.exists()) { /* ... create user logic ... */ }
            else { /* ... load user data logic ... */ }
            setupBalanceListener(); // Attach balance listener AFTER initial data load/creation
            // setupTransactionListener(); // Optional

        } catch (error) { handleFirebaseError(error, "loading/creating user data"); throw error; }
    }

    /** Disables app features usually due to critical initialization errors. */
    function disableAppFeatures() {
        console.error("Disabling core app features.");
        elements.navButtons.forEach(b => b.disabled = true);
        // Disable other key interactive elements
        if (elements.executeSwapButton) elements.executeSwapButton.disabled = true;
        if (elements.sendButton) elements.sendButton.disabled = true;
        // etc.
    }

    // --- Swap Functionality (Client-Side Simulation) ---

    /** Opens the token selection modal. */
    function openTokenModal(selectorType) {
        if (!elements.tokenModal) return;
        activeTokenSelector = selectorType;
        populateTokenListModal();
        if(elements.tokenSearchInput) elements.tokenSearchInput.value = '';
        elements.tokenModal.style.display = 'flex';
        if(elements.tokenSearchInput) elements.tokenSearchInput.focus();
    }

    /** Closes the token selection modal. */
    function closeTokenModal() {
        if (elements.tokenModal) elements.tokenModal.style.display = 'none';
        activeTokenSelector = null;
    }

    /** Populates the token list in the modal based on search term. */
    function populateTokenListModal(searchTerm = '') {
        if (!elements.tokenListModal) return;
        elements.tokenListModal.innerHTML = '';
        const lowerSearchTerm = searchTerm.toLowerCase().trim();

        const filteredTokens = Object.values(availableTokens).filter(token =>
            token.name.toLowerCase().includes(lowerSearchTerm) ||
            token.symbol.toLowerCase().includes(lowerSearchTerm)
        );

        if (filteredTokens.length === 0) { /* ... show no results ... */ return; }

        filteredTokens.sort((a, b) => a.name.localeCompare(b.name)).forEach(token => {
            const li = document.createElement('li');
            li.dataset.symbol = token.symbol;
            // Set innerHTML ensuring token logo handling
             li.innerHTML = `
                <img src="${token.logoUrl || 'placeholder.png'}" alt="${token.symbol}" class="token-logo" onerror="this.src='placeholder.png'; this.onerror=null;">
                <div class="token-details">
                    <div class="name">${token.name}</div>
                    <div class="symbol">${token.symbol}</div>
                </div>
            `;
            li.addEventListener('click', () => handleTokenSelection(token.symbol));
            elements.tokenListModal.appendChild(li);
        });
    }

    /** Handles token selection from the modal, updates state and UI. */
    function handleTokenSelection(selectedSymbol) {
        if (!activeTokenSelector || !selectedSymbol) return;
        console.log(`Token selected for ${activeTokenSelector}: ${selectedSymbol}`);

        // Prevent selecting the same token for both, swap if attempted
        if (activeTokenSelector === 'from' && selectedSymbol === swapState.toToken) {
            switchSwapTokens(); // Use the switch function directly
        } else if (activeTokenSelector === 'to' && selectedSymbol === swapState.fromToken) {
            switchSwapTokens(); // Use the switch function directly
        } else {
            // Set the selected token for the active selector
            swapState[activeTokenSelector === 'from' ? 'fromToken' : 'toToken'] = selectedSymbol;
            // If selecting 'from', might need to reset 'to' if only one token is available
            if (activeTokenSelector === 'from' && swapState.fromToken === swapState.toToken && Object.keys(availableTokens).length > 1) {
                 const otherToken = Object.keys(availableTokens).find(s => s !== swapState.fromToken);
                 swapState.toToken = otherToken || null;
            }
            // If selecting 'to', might need to reset 'from' if only one token is available (less likely)
            else if (activeTokenSelector === 'to' && swapState.fromToken === swapState.toToken && Object.keys(availableTokens).length > 1) {
                 const otherToken = Object.keys(availableTokens).find(s => s !== swapState.toToken);
                 swapState.fromToken = otherToken || null;
            }
        }

        closeTokenModal();
        calculateSwapRate(); // Recalculate rate and amounts with new selection
    }

    /** Updates the UI of a token selector button. */
    function updateTokenButtonUI(buttonElement, tokenSymbol) {
         if (!buttonElement) return;
         const tokenInfo = tokenSymbol ? availableTokens[tokenSymbol] : null;
         const logoElement = buttonElement.querySelector('.token-logo');
         const symbolElement = buttonElement.querySelector('.token-symbol');

         if (tokenInfo && logoElement && symbolElement) {
             logoElement.src = tokenInfo.logoUrl || 'placeholder.png';
             logoElement.alt = tokenInfo.symbol;
             symbolElement.textContent = tokenInfo.symbol;
         } else if (logoElement && symbolElement) { // Reset to placeholder
             logoElement.src = 'placeholder.png'; logoElement.alt = '-'; symbolElement.textContent = 'Select';
         }
    }

    /** Updates the 'Balance:' display under swap inputs. */
    function updateSwapBalancesUI() {
        if (elements.swapFromBalance) {
            const balance = userBalances[swapState.fromToken] || 0;
            elements.swapFromBalance.textContent = `Balance: ${formatTokenAmount(balance, swapState.fromToken === 'USD' ? 2 : 6)}`;
        }
        if (elements.swapToBalance) {
            const balance = userBalances[swapState.toToken] || 0;
            elements.swapToBalance.textContent = `Balance: ${formatTokenAmount(balance, swapState.toToken === 'USD' ? 2 : 6)}`;
        }
    }

    /** Sets default 'from' and 'to' tokens for swap if none are selected. */
    function populateTokenSelectors() {
        const symbols = Object.keys(availableTokens);
        if (!swapState.fromToken && symbols.includes('USD')) swapState.fromToken = 'USD';
        else if (!swapState.fromToken && symbols.length > 0) swapState.fromToken = symbols[0];

        if (!swapState.toToken && symbols.length > 1) {
            const defaultTo = symbols.find(s => s !== swapState.fromToken) || symbols[1];
            swapState.toToken = defaultTo;
        }
         updateTokenButtonUI(elements.swapFromTokenButton, swapState.fromToken);
         updateTokenButtonUI(elements.swapToTokenButton, swapState.toToken);
    }

    /** Calculates the base exchange rate (priceFrom / priceTo) without fees. */
    function calculateSwapRate() { /* ... (Calculates rate, handles errors, calls calculateSwapAmounts) ... */ }
    /** Calculates the final 'to' amount including the swap fee. */
    function calculateSwapAmounts() { /* ... (Applies fee based on direction, updates swapState.toAmount, calls updateSwapUI) ... */ }
    /** Debounced wrapper for amount calculation on input. */
    const debouncedCalculateSwapAmounts = debounce(calculateSwapAmounts, DEBOUNCE_DELAY);
    /** Handles input changes in the 'from' amount field. */
    function handleFromAmountChange() { /* ... (Updates swapState.fromAmount, calls debouncedCalculateSwapAmounts) ... */ }
    /** Switches the 'from' and 'to' tokens and amounts. */
    function switchSwapTokens() { /* ... (Updates swapState, recalculates rate/amounts) ... */ }
    /** Validates swap inputs (tokens selected, amounts valid, sufficient balance). */
    function validateSwapInput() { /* ... (Enables/disables executeSwapButton, shows balance warning) ... */ }
    /** Updates all elements on the swap page based on swapState. */
    function updateSwapUI() { /* ... (Calls sub-update functions, validates input) ... */ }
    /** Executes the swap (INSECURE CLIENT-SIDE SIMULATION). */
    async function executeSwap() { /* ... (Client-side balance updates and transaction logging - NEEDS BACKEND) ... */ }
    /** Resets or sets up the swap page state and UI. */
    function setupSwapPage() { /* ... (Resets amounts, calculates rate, updates UI) ... */ }


    // --- Internal Send Functionality (Client-Side Simulation) ---

    /** Populates the asset dropdown on the Send page. Ensures tokens are loaded. */
    function updateWithdrawAssetSelector() {
        if (!elements.withdrawAssetSelect) return;
        const previousValue = elements.withdrawAssetSelect.value;
        elements.withdrawAssetSelect.innerHTML = '<option value="">-- Select Asset --</option>';

        if (Object.keys(availableTokens).length === 0) {
             console.warn("Cannot populate send asset selector: No tokens available.");
             return; // Exit if tokens aren't loaded
        }

        Object.keys(availableTokens)
            .sort((a, b) => a.localeCompare(b))
            .forEach(symbol => {
                const tokenInfo = availableTokens[symbol];
                const option = document.createElement('option');
                option.value = symbol;
                option.textContent = `${tokenInfo.name} (${symbol})`;
                elements.withdrawAssetSelect.appendChild(option);
            });

        if (previousValue && elements.withdrawAssetSelect.querySelector(`option[value="${previousValue}"]`)) {
            elements.withdrawAssetSelect.value = previousValue;
        } else {
            elements.withdrawAssetSelect.value = "";
        }
        updateWithdrawPageBalance(); // Update balance display
    }

    /** Updates the 'Available' balance display on the Send page. */
    function updateWithdrawPageBalance() {
        if (!elements.withdrawAvailableBalance || !elements.withdrawAssetSelect) return;
        const selectedSymbol = elements.withdrawAssetSelect.value;
        const balance = userBalances[selectedSymbol] || 0;
        const decimals = selectedSymbol === 'USD' ? 2 : 6;
        elements.withdrawAvailableBalance.textContent = `${formatTokenAmount(balance, decimals)} ${selectedSymbol || ''}`;
        if (elements.withdrawMaxButton) elements.withdrawMaxButton.disabled = balance <= 0;
        validateSendInput(); // Re-validate inputs
    }

    /** Validates inputs on the Send page (asset, amount, recipient ID, balance). */
    function validateSendInput() {
         if (!elements.sendButton || !elements.withdrawAssetSelect || !elements.withdrawAmountInput || !elements.withdrawRecipientIdInput || !elements.withdrawStatus) return;
         const selectedSymbol = elements.withdrawAssetSelect.value;
         const amount = sanitizeFloat(elements.withdrawAmountInput.value);
         const balance = userBalances[selectedSymbol] || 0;
         const recipientIdStr = elements.withdrawRecipientIdInput.value.trim();
         const recipientId = sanitizeInt(recipientIdStr);
         let isValid = true; let statusMsg = '';
         elements.withdrawStatus.className = 'status-message';

         if (!selectedSymbol) isValid = false;
         else if (amount <= 0) isValid = false;
         else if (amount > balance) { isValid = false; statusMsg = 'Amount exceeds available balance.'; elements.withdrawStatus.className = 'status-message error'; }
         else if (!recipientIdStr) isValid = false;
         else if (!/^\d+$/.test(recipientIdStr) || recipientId <= 0) { isValid = false; statusMsg = 'Invalid Recipient Chat ID.'; elements.withdrawStatus.className = 'status-message error'; }
         else if (currentUser && recipientId === currentUser.id) { isValid = false; statusMsg = 'Cannot send to yourself.'; elements.withdrawStatus.className = 'status-message error'; }

         elements.sendButton.disabled = !isValid;
         elements.withdrawStatus.textContent = statusMsg;
    }

    /** Executes the internal transfer (INSECURE CLIENT-SIDE SIMULATION). */
    async function handleSend() {
         if (!userDbRef || !currentUser || !db || !elements.sendButton || elements.sendButton.disabled) return;
         const selectedSymbol = elements.withdrawAssetSelect.value;
         const recipientId = sanitizeInt(elements.withdrawRecipientIdInput.value);
         const amount = sanitizeFloat(elements.withdrawAmountInput.value);
         const senderId = currentUser.id;
         const senderBalance = userBalances[selectedSymbol] || 0;

         if (!selectedSymbol || amount <= 0 || !recipientId || recipientId === senderId || senderBalance < amount) { /* ... final validation ... */ return; }

         showLoading("Processing Transfer...");
         elements.sendButton.disabled = true;
         if (elements.withdrawStatus) { /* ... set pending status ... */ }

         // ** INSECURE CLIENT-SIDE RECIPIENT CHECK **
         const recipientRef = db.ref(`users/${recipientId}`);
         let recipientExists = false;
         try {
             const recipientSnapshot = await recipientRef.child('profile').once('value');
             recipientExists = recipientSnapshot.exists();
         } catch (error) { /* ... handle check error ... */ return; }
         if (!recipientExists) { /* ... handle recipient not found ... */ return; }
         // ** END INSECURE CHECK **

         if (elements.withdrawStatus) elements.withdrawStatus.textContent = 'Processing transfer...';

         // ** INSECURE CLIENT-SIDE ATOMIC UPDATE SIMULATION **
         const updates = {};
         const senderBalancePath = `/users/${senderId}/balances/${selectedSymbol}`;
         const recipientBalancePath = `/users/${recipientId}/balances/${selectedSymbol}`;
         let recipientCurrentBalance = 0;
         try { // Fetch recipient balance just before write (still risky)
             const recipBalanceSnapshot = await recipientRef.child(`balances/${selectedSymbol}`).once('value');
             recipientCurrentBalance = sanitizeFloat(recipBalanceSnapshot.val());
         } catch (e) { console.warn("Could not read recipient balance before update", e); }
         const newSenderBalance = senderBalance - amount;
         const newRecipientBalance = recipientCurrentBalance + amount;
         updates[senderBalancePath] = sanitizeFloat(newSenderBalance.toFixed(PRECISION));
         updates[recipientBalancePath] = sanitizeFloat(newRecipientBalance.toFixed(PRECISION));

         // Log transaction
         const txId = db.ref(`/transactions/${senderId}`).push().key;
         if (txId) { /* ... create senderTx and receiverTx, add to updates ... */ }
         else { /* ... handle TX ID generation failure ... */ return; }
         // ** END INSECURE UPDATE PREPARATION **

         try {
             await db.ref().update(updates); // Attempt update
              if (elements.withdrawStatus) { /* ... set success status ... */ }
              if(elements.withdrawAmountInput) elements.withdrawAmountInput.value = '';
              if(elements.withdrawRecipientIdInput) elements.withdrawRecipientIdInput.value = '';
              setTimeout(() => { if (elements.withdrawStatus) elements.withdrawStatus.textContent = ''; }, 3000);
         } catch (error) { handleFirebaseError(error, "executing internal transfer"); /* ... set error status ... */ }
         finally { hideLoading(); /* Let listener re-validate button */ }
    }

    /** Resets or sets up the Send page state and UI. */
    function setupSendPage() {
        console.log("Setting up Send Page");
        if(elements.withdrawAssetSelect) updateWithdrawAssetSelector(); // Ensure assets are populated
        if(elements.withdrawAmountInput) elements.withdrawAmountInput.value = '';
        if(elements.withdrawRecipientIdInput) elements.withdrawRecipientIdInput.value = '';
        if(elements.withdrawStatus) { elements.withdrawStatus.textContent = ''; elements.withdrawStatus.className = 'status-message'; }
        // updateWithdrawPageBalance(); // Called by updateWithdrawAssetSelector
        validateSendInput(); // Set initial button state
    }


    // --- Event Listeners Setup ---
    /** Attaches all necessary event listeners to the DOM elements. */
    function setupEventListeners() {
        console.log("Setting up event listeners...");
        // Navigation
        elements.navButtons.forEach(button => button.addEventListener('click', () => { if (!button.classList.contains('active')) showPage(button.dataset.page); }));
        elements.backButtons.forEach(button => button.addEventListener('click', () => showPage(button.dataset.target || 'home-page')));
        if (elements.refreshButton) elements.refreshButton.addEventListener('click', async () => { /* ... Refresh logic ... */ });
        // Swap Page Listeners
        if (elements.swapFromAmountInput) elements.swapFromAmountInput.addEventListener('input', handleFromAmountChange);
        if (elements.swapSwitchButton) elements.swapSwitchButton.addEventListener('click', switchSwapTokens);
        if (elements.executeSwapButton) elements.executeSwapButton.addEventListener('click', executeSwap);
        if (elements.swapFromTokenButton) elements.swapFromTokenButton.addEventListener('click', () => openTokenModal('from'));
        if (elements.swapToTokenButton) elements.swapToTokenButton.addEventListener('click', () => openTokenModal('to'));
        // Token Modal Listeners
        if (elements.closeModalButton) elements.closeModalButton.addEventListener('click', closeTokenModal);
        if (elements.tokenSearchInput) elements.tokenSearchInput.addEventListener('input', debounce((e) => populateTokenListModal(e.target.value), 250));
        if (elements.tokenModal) elements.tokenModal.addEventListener('click', (e) => { if (e.target === elements.tokenModal) closeTokenModal(); });
        // Send Page Listeners
        if (elements.withdrawAssetSelect) elements.withdrawAssetSelect.addEventListener('change', updateWithdrawPageBalance);
        if (elements.withdrawAmountInput) elements.withdrawAmountInput.addEventListener('input', debounce(validateSendInput, DEBOUNCE_DELAY));
        if (elements.withdrawRecipientIdInput) elements.withdrawRecipientIdInput.addEventListener('input', debounce(validateSendInput, DEBOUNCE_DELAY));
        if (elements.withdrawMaxButton) elements.withdrawMaxButton.addEventListener('click', () => { /* Max button logic */ });
        if (elements.sendButton) elements.sendButton.addEventListener('click', handleSend);
        console.log("Event listeners attached.");
    }


    // --- App Initialization ---
    /** Main function to initialize and start the wallet application. */
    async function startApp() {
        console.log("Starting AB Wallet Application...");
        showLoading("Initializing...");
        try {
            await tg.ready();
            tg.expand();
            tg.enableClosingConfirmation();
            console.log("Telegram WebApp SDK Ready.");

            // Apply theme (using CSS variables as primary, TG as fallback)
            document.body.style.backgroundColor = tg.themeParams.bg_color || getComputedStyle(document.documentElement).getPropertyValue('--bg-main').trim();
            document.body.style.color = tg.themeParams.text_color || getComputedStyle(document.documentElement).getPropertyValue('--text-main').trim();

            setupEventListeners(); // Attach listeners early

            // Get User Data (CRITICAL STEP)
            if (tg.initDataUnsafe?.user) {
                currentUser = tg.initDataUnsafe.user;
                console.log(`User Identified: ${currentUser.id}`);
                displayUserInfo();

                // Initialize Firebase
                if (!firebase.apps.length) { firebaseApp = firebase.initializeApp(firebaseConfig); }
                else { firebaseApp = firebase.app(); }
                db = firebase.database();
                console.log("Firebase Initialized.");

                // Fetch Tokens THEN Initialize User Data & Listeners
                await fetchAvailableTokens(); // Must have tokens before user init potentially needs them
                await initializeFirebaseAndUser();

                // Show initial page (Home will trigger transaction fetch)
                showPage('home-page');

            } else { throw new Error("Could not retrieve valid Telegram user data."); }

            hideLoading(); // Success
            console.log("AB Wallet Initialized Successfully.");

        } catch (error) {
            console.error("CRITICAL INITIALIZATION FAILURE:", error);
            handleFirebaseError(error, "App Initialization");
            showLoading("Error Loading Wallet");
            disableAppFeatures();
            if(elements.mainContent) elements.mainContent.innerHTML = `<div class="card status-message error" style="margin-top: 50px;">Failed to initialize AB Wallet. Please restart. (${error.message || ''})</div>`;
        }
    }

    // Start the application initialization process
    startApp();

}); // End DOMContentLoaded
