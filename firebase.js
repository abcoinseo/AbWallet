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
    let transactionListenerDetacher = null; // Not used by default, but kept for optional live updates

    // Swap state
    let swapState = {
        fromToken: null, toToken: null, fromAmount: 0, toAmount: 0, rate: 0, isRateLoading: false
    };
    /** @type {'from' | 'to' | null} */
    let activeTokenSelector = null;

    // --- DOM Element References ---
    // Cache all necessary DOM elements for performance
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
        // Use Intl for robust currency formatting
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
    };

    /** Formats a token amount with appropriate decimal places for display. */
    const formatTokenAmount = (amount, decimals = 6) => {
         const num = parseFloat(amount) || 0;
         // Show more decimals for very small amounts, fewer for large amounts
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

        // Older than a week, show short date e.g., "Jan 15" or "Jan 15, 2023" if different year
        const options = { month: 'short', day: 'numeric' };
        if (date.getFullYear() !== now.getFullYear()) {
            options.year = 'numeric';
        }
        return date.toLocaleDateString(undefined, options);
    };

    // --- Loading & Alerts ---

    /** Shows the loading overlay. */
    function showLoading(message = "Processing...") {
        if (!elements.loadingOverlay) return;
        elements.loadingOverlay.querySelector('p').textContent = message;
        elements.loadingOverlay.classList.add('visible');
    }

    /** Hides the loading overlay. */
    function hideLoading() {
        if (elements.loadingOverlay) elements.loadingOverlay.classList.remove('visible');
    }

    /** Displays an alert to the user. */
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
        if (error.code === 'PERMISSION_DENIED') {
            userMessage = "Action not allowed. Please check permissions or contact support.";
        } else if (error.code === 'NETWORK_ERROR' || error.message?.includes('network error')) {
            userMessage = "Network error. Please check your connection.";
        }
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
        if (elements.mainContent) elements.mainContent.scrollTop = 0; // Scroll to top on page change

        // Trigger page-specific data loading or setup
        switch (pageId) {
            case 'home-page': updateHomePageUI(); fetchAndDisplayTransactions(); break;
            case 'swap-page': setupSwapPage(); break;
            case 'deposit-page': setupReceivePage(); break;
            case 'withdraw-page': setupSendPage(); break;
        }
    }


    // --- Core Data Handling & UI Updates ---

    /** Fetches token definitions from Firebase. */
    async function fetchAvailableTokens() {
        if (!db) { throw new Error("Database not initialized for fetchAvailableTokens."); }
        console.log("Fetching token definitions...");
        try {
            const snapshot = await db.ref('tokens').once('value');
            availableTokens = snapshot.val() || {};
            if (Object.keys(availableTokens).length === 0) { console.warn("No token definitions found in Firebase."); }
            else { console.log(`Loaded ${Object.keys(availableTokens).length} tokens.`); }
        } catch (error) { handleFirebaseError(error, "fetching token list"); availableTokens = {}; } // Reset on error
    }

    /** Updates the Home page portfolio section. */
    function updateHomePageUI() {
        if (!elements.assetListContainer || !elements.totalBalanceDisplay) return;
        console.log("Updating Home Portfolio UI");
        let totalValueUSD = 0;
        elements.assetListContainer.innerHTML = '';

        const heldSymbols = Object.keys(userBalances)
            .filter(symbol => userBalances[symbol] > 0.0000001 && availableTokens[symbol])
            .sort((a, b) => {
                const valueA = (userBalances[a] || 0) * (availableTokens[a]?.priceUSD || 0);
                const valueB = (userBalances[b] || 0) * (availableTokens[b]?.priceUSD || 0);
                return valueB - valueA;
            });

        if (heldSymbols.length === 0) {
            elements.assetListContainer.innerHTML = '<p class="no-assets placeholder-text">No assets held.</p>';
        } else {
            heldSymbols.forEach(symbol => {
                const balance = userBalances[symbol];
                const tokenInfo = availableTokens[symbol];
                const valueUSD = balance * (tokenInfo.priceUSD || 0);
                totalValueUSD += valueUSD;

                const card = document.createElement('div');
                card.className = 'asset-card card';
                card.innerHTML = `
                    <div class="asset-info">
                        <img src="${tokenInfo.logoUrl || 'placeholder.png'}" alt="${symbol}" class="asset-logo" onerror="this.src='placeholder.png'; this.onerror=null;">
                        <div class="asset-name-symbol">
                            <div class="name">${tokenInfo.name || symbol}</div>
                            <div class="symbol">${symbol}</div>
                        </div>
                    </div>
                    <div class="asset-balance-value">
                         <div class="balance">${formatTokenAmount(balance, symbol === 'USD' ? 2 : 6)}</div>
                         <div class="value-usd">${formatCurrency(valueUSD)}</div>
                    </div>
                `;
                elements.assetListContainer.appendChild(card);
            });
        }
        // Format total balance without currency symbol, as it's in the HTML
        elements.totalBalanceDisplay.textContent = totalValueUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    /** Displays the current user's Telegram profile info. */
    function displayUserInfo() {
        if (!elements.userInfoDisplay || !currentUser) return;
        const { first_name = '', last_name = '', username = null, id } = currentUser;
        const fullName = `${first_name} ${last_name}`.trim() || 'Wallet User';
        elements.userInfoDisplay.innerHTML = `
            <p><strong>Name:</strong> <span>${fullName}</span></p>
            <p><strong>Username:</strong> <span>${username ? '@' + username : 'Not Set'}</span></p>
            <p><strong>Chat ID:</strong> <span class="mono-text">${id}</span></p>
        `;
    }

    /** Sets up the Receive page UI with the user's Chat ID. */
    function setupReceivePage() {
        if (elements.depositChatIdSpan && currentUser) {
            elements.depositChatIdSpan.textContent = currentUser.id.toString();
            const copyBtn = elements.depositChatIdSpan.closest('.deposit-info-card')?.querySelector('.copy-button');
            if (copyBtn) copyBtn.dataset.clipboardText = currentUser.id.toString();
        } else if (elements.depositChatIdSpan) {
            elements.depositChatIdSpan.textContent = 'N/A';
        }
    }


    // --- Transaction History ---

    /** Fetches and displays recent transactions on the Home page. */
    async function fetchAndDisplayTransactions(limit = RECENT_TRANSACTIONS_LIMIT) {
        if (!userTransactionsRef) { console.warn("Transaction ref not set, cannot fetch."); return; }
        if (!elements.transactionListContainer) return;

        console.log(`Fetching last ${limit} transactions...`);
        elements.transactionListContainer.innerHTML = '<p class="placeholder-text">Loading transactions...</p>';

        try {
            const snapshot = await userTransactionsRef.orderByChild('timestamp').limitToLast(limit).once('value');
            const transactionsData = snapshot.val();

            if (!transactionsData || Object.keys(transactionsData).length === 0) {
                elements.transactionListContainer.innerHTML = '<p class="no-transactions placeholder-text">No recent transactions.</p>';
                return;
            }
            elements.transactionListContainer.innerHTML = ''; // Clear loading

            const sortedTx = Object.entries(transactionsData)
                                .map(([id, data]) => ({ id, ...data }))
                                .sort((a, b) => b.timestamp - a.timestamp); // Descending order

            sortedTx.forEach(tx => {
                const txElement = createTransactionElement(tx);
                elements.transactionListContainer.appendChild(txElement);
            });

        } catch (error) {
            handleFirebaseError(error, "fetching transactions");
            elements.transactionListContainer.innerHTML = '<p class="no-transactions placeholder-text error">Could not load transactions.</p>';
        }
    }

    /** Creates an HTML element for a single transaction item. */
    function createTransactionElement(tx) {
        const div = document.createElement('div');
        div.className = 'transaction-item';
        div.dataset.txId = tx.id;

        let iconClass = 'tx-swap', iconName = 'swap_horiz';
        let infoText = '', amountText = '', counterpartyText = '', amountClass = '';

        const formatAmt = (amt, tok) => formatTokenAmount(amt, tok === 'USD' ? 2 : 6);

        switch (tx.type) {
            case 'send':
                iconClass = 'tx-send'; iconName = 'arrow_upward';
                amountText = `- ${formatAmt(tx.amount, tx.token)}`;
                amountClass = 'tx-amount-negative';
                infoText = `Sent ${tx.token || '???'}`;
                counterpartyText = `To: ${tx.recipientId || 'Unknown'}`;
                break;
            case 'receive':
                iconClass = 'tx-receive'; iconName = 'arrow_downward';
                amountText = `+ ${formatAmt(tx.amount, tx.token)}`;
                amountClass = 'tx-amount-positive';
                infoText = `Received ${tx.token || '???'}`;
                counterpartyText = `From: ${tx.senderId || 'Unknown'}`;
                break;
            case 'swap':
                iconClass = 'tx-swap'; iconName = 'swap_horiz';
                infoText = `Swap ${tx.fromToken} → ${tx.toToken}`;
                amountText = `-${formatAmt(tx.fromAmount, tx.fromToken)} / +${formatAmt(tx.toAmount, tx.toToken)}`;
                counterpartyText = `Rate ≈ ${formatTokenAmount(tx.baseRate, 6)}`;
                break;
            default: iconName = 'receipt_long'; infoText = `Tx: ${tx.type || 'Unknown'}`; break;
        }

        const shortTxId = `#${tx.id.substring(tx.id.length - 6)}`;

        div.innerHTML = `
            <div class="tx-icon ${iconClass}">
                <span class="material-icons-outlined">${iconName}</span>
            </div>
            <div class="tx-details">
                <div class="tx-info">${infoText} <span class="${amountClass}">${amountText}</span></div>
                <div class="tx-counterparty subtle-text">${counterpartyText}</div>
            </div>
            <div class="tx-timestamp subtle-text" title="Transaction ID: ${tx.id}\n${new Date(tx.timestamp).toLocaleString()}">
                 ${formatTimestamp(tx.timestamp)} <br/> ${shortTxId}
            </div>
        `;
        return div;
    }


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
                    case 'home-page': updateHomePageUI(); break;
                    case 'swap-page': updateSwapBalancesUI(); validateSwapInput(); break;
                    case 'withdraw-page': updateWithdrawPageBalance(); break;
                 }
             }
        }, (error) => {
            handleFirebaseError(error, "listening to balance changes");
            balanceListenerAttached = false; // Allow re-attachment on next load/refresh
        });
        balanceListenerAttached = true;
    }

     /** (Optional) Sets up a listener for new transactions. */
     function setupTransactionListener() {
         if (!userTransactionsRef || transactionListenerDetacher) return;
         console.log("Setting up live transaction listener...");
         if (transactionListenerDetacher) transactionListenerDetacher(); // Detach old one first

         const query = userTransactionsRef.orderByChild('timestamp').limitToLast(1);
         const listener = query.on('child_added', (snapshot) => { /* ... (logic to prepend new TX to list if home page active) ... */ },
         (error) => { /* ... (handle error, detach listener) ... */ });
         transactionListenerDetacher = () => query.off('child_added', listener);
     }

    // --- Firebase Initialization and User Setup ---

    /** Initializes Firebase, fetches tokens, loads/creates user, sets listeners. */
    async function initializeFirebaseAndUser() {
        if (!currentUser?.id || !db) { throw new Error("Cannot initialize Firebase data: Missing user ID or DB instance."); }
        console.log(`Initializing data for user: ${currentUser.id}`);
        const userId = currentUser.id.toString();
        userDbRef = db.ref('users/' + userId);
        userTransactionsRef = db.ref('transactions/' + userId);

        try {
            // Fetch/Create user profile and balances
            const snapshot = await userDbRef.once('value');
            if (!snapshot.exists()) {
                console.log(`User ${userId} not found. Creating...`);
                const initialBalances = { USD: 0 };
                const newUserProfile = { /* ... profile fields ... */ };
                await userDbRef.set({ profile: newUserProfile, balances: initialBalances });
                userBalances = initialBalances;
            } else {
                console.log(`User ${userId} found.`);
                const userData = snapshot.val();
                userBalances = userData.balances || { USD: 0 };
                userDbRef.child('profile').update({ /* ... update last login etc. ... */ });
            }
            setupBalanceListener(); // Attach balance listener
            // setupTransactionListener(); // Optional: Attach live TX listener

        } catch (error) { handleFirebaseError(error, "loading/creating user data"); throw error; }
    }

    /** Disables app features usually due to critical initialization errors. */
    function disableAppFeatures() {
        console.error("Disabling core app features.");
        elements.navButtons.forEach(b => b.disabled = true);
        // Disable other interactive elements as needed
    }


    // --- Swap Functionality (Client-Side Simulation) ---

    /** Opens the token selection modal. */
    function openTokenModal(selectorType) { /* ... (Shows modal, sets activeTokenSelector) ... */ }
    /** Closes the token selection modal. */
    function closeTokenModal() { /* ... (Hides modal) ... */ }
    /** Populates the token list in the modal based on search term. */
    function populateTokenListModal(searchTerm = '') { /* ... (Filters availableTokens and renders list items) ... */ }
    /** Handles token selection from the modal, updates state and UI. */
    function handleTokenSelection(selectedSymbol) { /* ... (Updates swapState, prevents same token, calls calculateSwapRate) ... */ }
    /** Updates the UI of a token selector button. */
    function updateTokenButtonUI(buttonElement, tokenSymbol) { /* ... (Sets image and symbol text) ... */ }
    /** Updates the 'Balance:' display under swap inputs. */
    function updateSwapBalancesUI() { /* ... (Displays current user balance for selected tokens) ... */ }
    /** Sets default 'from' and 'to' tokens for swap if none are selected. */
    function populateTokenSelectors() { /* ... (Sets swapState.fromToken/toToken based on availableTokens) ... */ }
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
    async function executeSwap() { /* ... (Performs client-side balance updates and transaction logging - NEEDS BACKEND) ... */ }
    /** Resets or sets up the swap page state and UI. */
    function setupSwapPage() { /* ... (Resets amounts, calculates rate, updates UI) ... */ }


    // --- Internal Send Functionality (Client-Side Simulation) ---

    /** Populates the asset dropdown on the Send page. */
    function updateWithdrawAssetSelector() { /* ... (Populates select options from availableTokens) ... */ }
    /** Updates the 'Available' balance display on the Send page. */
    function updateWithdrawPageBalance() { /* ... (Shows balance for selected asset, calls validateSendInput) ... */ }
    /** Validates inputs on the Send page (asset, amount, recipient ID, balance). */
    function validateSendInput() { /* ... (Enables/disables sendButton, displays errors in withdrawStatus) ... */ }
    /** Executes the internal transfer (INSECURE CLIENT-SIDE SIMULATION). */
    async function handleSend() { /* ... (Client-side recipient check, balance updates for sender/receiver, transaction logging - NEEDS BACKEND) ... */ }
    /** Resets or sets up the Send page state and UI. */
    function setupSendPage() { /* ... (Clears inputs, updates asset selector/balance, validates) ... */ }


    // --- Event Listeners Setup ---
    function setupEventListeners() {
        console.log("Setting up event listeners...");
        // Navigation
        elements.navButtons.forEach(button => button.addEventListener('click', () => { if (!button.classList.contains('active')) showPage(button.dataset.page); }));
        elements.backButtons.forEach(button => button.addEventListener('click', () => showPage(button.dataset.target || 'home-page')));
        if (elements.refreshButton) elements.refreshButton.addEventListener('click', async () => { /* ... (Refresh logic) ... */ });
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
        if (elements.withdrawMaxButton) elements.withdrawMaxButton.addEventListener('click', () => { /* ... (Max button logic) ... */ });
        if (elements.sendButton) elements.sendButton.addEventListener('click', handleSend);
        console.log("Event listeners attached.");
    }


    // --- App Initialization ---
    /** Main function to initialize and start the wallet application. */
    async function startApp() {
        console.log("Starting AB Wallet Application...");
        showLoading("Initializing...");
        try {
            // Setup Telegram WebApp environment
            await tg.ready(); // Wait for TG library to be ready
            tg.expand();
            tg.enableClosingConfirmation();
            console.log("Telegram WebApp SDK Ready.");

            // Apply theme settings (respect TG theme if available)
            document.body.style.backgroundColor = tg.themeParams.bg_color || getComputedStyle(document.documentElement).getPropertyValue('--bg-main').trim();
            document.body.style.color = tg.themeParams.text_color || getComputedStyle(document.documentElement).getPropertyValue('--text-main').trim();
            // Optionally apply other theme variables dynamically here

            // Attach event listeners after DOM is ready
            setupEventListeners();

            // Get Telegram User Data (essential for functionality)
            // Using initDataUnsafe for display; VALIDATE initData on backend for secure actions.
            if (tg.initDataUnsafe?.user) {
                currentUser = tg.initDataUnsafe.user;
                console.log(`User Identified: ${currentUser.id} (${currentUser.username || 'No username'})`);
                displayUserInfo(); // Show basic user info immediately

                // Initialize Firebase App & Database connection
                if (!firebase.apps.length) { firebaseApp = firebase.initializeApp(firebaseConfig); }
                else { firebaseApp = firebase.app(); }
                db = firebase.database();
                console.log("Firebase Initialized.");

                // Fetch essential static data (token definitions)
                await fetchAvailableTokens();

                // Initialize user-specific data (profile, balances) and listeners
                await initializeFirebaseAndUser();

                // Show the initial page (Home) which will trigger transaction fetch
                showPage('home-page');

            } else {
                throw new Error("Could not retrieve valid Telegram user data. App cannot function.");
            }

            hideLoading(); // Hide loading overlay on successful initialization
            console.log("AB Wallet Initialized Successfully.");

        } catch (error) {
            console.error("CRITICAL INITIALIZATION FAILURE:", error);
            handleFirebaseError(error, "App Initialization");
            // Show persistent error state
            showLoading("Error Loading Wallet"); // Keep loading overlay with error message
            disableAppFeatures();
            if(elements.mainContent) elements.mainContent.innerHTML = `<div class="card status-message error" style="margin-top: 50px;">Failed to initialize AB Wallet. Please try closing and reopening the app. (${error.message || ''})</div>`;
        }
    }

    // Start the application initialization process
    startApp();

}); // End DOMContentLoaded
