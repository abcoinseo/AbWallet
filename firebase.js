// @ts-check // Enables type checking in VS Code, optional but helpful

/**
 * ====================================
 * AB Wallet - firebase.js (Client-Side Simulation - vFINAL)
 * ====================================
 *
 * Handles Firebase interaction, application logic, and UI updates for the
 * AB Wallet Telegram Web App.
 *
 * ---- CRITICAL SECURITY WARNING ----
 * THIS IS A CLIENT-SIDE IMPLEMENTATION FOR DEMONSTRATION PURPOSES ONLY.
 * IT PERFORMS FINANCIAL OPERATIONS DIRECTLY FROM THE CLIENT, WHICH IS INSECURE.
 * A secure backend is REQUIRED for a production application handling real value.
 * ------------------------------------
 */

document.addEventListener('DOMContentLoaded', () => {
    'use strict'; // Enforce stricter parsing and error handling

    // --- Configuration ---
    // WARNING: Ensure Firebase rules are SECURE for production. DEMO requires insecure rules.
    const firebaseConfig = {
        apiKey: "AIzaSyBW1WPXUN8DYhT6npZQYoQ3l4J-jFSbzfg", // SECURE VIA RULES/BACKEND IN PRODUCTION
        authDomain: "ab-studio-marketcap.firebaseapp.com",
        databaseURL: "https://ab-studio-marketcap-default-rtdb.firebaseio.com",
        projectId: "ab-studio-marketcap",
        storageBucket: "ab-studio-marketcap.firebasestorage.app",
        messagingSenderId: "115268088088",
        appId: "1:115268088088:web:65643a047f92bfaa66ee6d"
    };

    // --- Constants ---
    const SWAP_FEE_PERCENT = 0.1; // 0.1% swap fee
    const DEBOUNCE_DELAY = 350; // Delay for input calculations (ms)
    const PRECISION = 8; // Decimal places for storing non-USD crypto balances
    const RECENT_TRANSACTIONS_LIMIT = 20; // Max transactions to show on home page
    const MIN_SEND_AMOUNT = 0.000001; // Smallest amount that can be sent (adjust as needed)

    // --- Globals ---
    const tg = window.Telegram.WebApp;
    /** @type {Telegram.WebApp.WebAppUser | null} Current Telegram User object */
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

    /** State for the swap interface */
    let swapState = {
        fromToken: /** @type {string | null} */ (null),
        toToken: /** @type {string | null} */ (null),
        fromAmount: 0,
        toAmount: 0, // Estimated amount after fees
        rate: 0, // Base rate before fees
        isRateLoading: false
    };
    /** @type {'from' | 'to' | null} Indicates which token selector modal is active */
    let activeTokenSelector = null;
    /** @type {boolean} Flag to prevent concurrent actions */
    let isProcessingAction = false;


    // --- DOM Element References ---
    // Cache elements for performance. Use optional chaining for robustness.
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
        withdrawAssetSelect: /** @type {HTMLSelectElement | null} */ (document.getElementById('withdraw-asset-select')),
        withdrawAvailableBalance: document.getElementById('withdraw-available-balance'),
        withdrawRecipientIdInput: /** @type {HTMLInputElement | null} */ (document.getElementById('withdraw-recipient-id')),
        withdrawAmountInput: /** @type {HTMLInputElement | null} */ (document.getElementById('withdraw-amount')),
        sendButton: /** @type {HTMLButtonElement | null} */ (document.getElementById('send-button')),
        withdrawMaxButton: document.getElementById('withdraw-max-button'),
        withdrawStatus: document.getElementById('withdraw-status'),
        // Swap Page
        swapFromAmountInput: /** @type {HTMLInputElement | null} */ (document.getElementById('swap-from-amount')),
        swapToAmountInput: /** @type {HTMLInputElement | null} */ (document.getElementById('swap-to-amount')),
        swapFromTokenButton: /** @type {HTMLButtonElement | null} */ (document.getElementById('swap-from-token-button')),
        swapToTokenButton: /** @type {HTMLButtonElement | null} */ (document.getElementById('swap-to-token-button')),
        swapFromBalance: document.getElementById('swap-from-balance'),
        swapToBalance: document.getElementById('swap-to-balance'),
        swapSwitchButton: document.getElementById('swap-switch-button'),
        swapRateDisplay: document.getElementById('swap-rate-display'),
        executeSwapButton: /** @type {HTMLButtonElement | null} */ (document.getElementById('execute-swap-button')),
        swapStatus: document.getElementById('swap-status'),
        // Token Modal
        tokenModal: document.getElementById('token-selector-modal'),
        tokenSearchInput: /** @type {HTMLInputElement | null} */ (document.getElementById('token-search-input')),
        tokenListModal: document.getElementById('token-list-modal'),
        closeModalButton: document.getElementById('token-selector-modal')?.querySelector('.close-modal-button'),
    };


    // --- Utility Functions ---

    /** Formats a number as USD currency string. */
    const formatCurrency = (amount) => {
        const num = sanitizeFloat(amount);
        // Ensure USD formatting is consistent
        return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    /** Formats a token amount with dynamic decimal places. */
    const formatTokenAmount = (amount, decimals = 6) => {
         const num = sanitizeFloat(amount);
         const effectiveDecimals = num !== 0 && Math.abs(num) < 0.01 ? Math.max(decimals, 4) : (Math.abs(num) > 10000 ? 2 : decimals);
         return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: effectiveDecimals });
    };

    /** Parses a value to a float, stripping non-numeric chars except '.' and '-', defaulting to 0. */
    const sanitizeFloat = (value) => parseFloat(String(value).replace(/[^0-9.-]+/g, "")) || 0;

    /** Parses a value to a positive integer, stripping non-digits, defaulting to 0. */
    const sanitizeInt = (value) => Math.max(0, parseInt(String(value).replace(/[^0-9]+/g, ""), 10) || 0);

    /** Debounce utility function. */
    const debounce = (func, delay) => { /* ... (same as before) ... */ };

    /** Formats a Firebase timestamp into a user-friendly relative string or date. */
    const formatTimestamp = (timestamp) => { /* ... (same as before) ... */ };

    /** Sets the status message and class for UI feedback. */
    const setStatusMessage = (element, message, type = 'info') => {
        if (!element) return;
        element.textContent = message;
        element.className = `status-message ${type}`; // type can be 'info', 'success', 'error', 'pending'
        // Automatically clear non-error/pending messages after a delay
        if (message && type !== 'error' && type !== 'pending') {
            setTimeout(() => {
                // Clear only if the message hasn't changed in the meantime
                if (element.textContent === message) {
                    element.textContent = '';
                    element.className = 'status-message';
                }
            }, 3500);
        }
    };

    // --- Loading & Alerts ---

    /** Shows the loading overlay. */
    function showLoading(message = "Processing...") { /* ... (same as before) ... */ }
    /** Hides the loading overlay. */
    function hideLoading() { /* ... (same as before) ... */ }
    /** Displays an alert using Telegram's UI or fallback. */
    function showTgAlert(message, title = 'Alert') { /* ... (same as before) ... */ }
    /** Centralized Firebase error handler. */
    function handleFirebaseError(error, context = "Firebase Operation") { /* ... (same as before) ... */ }


    // --- Navigation & Page Handling ---

    /** Switches the active page, updates nav, resets scroll, and calls page setup. */
    function showPage(pageId) { /* ... (same as before, calls setup functions) ... */ }


    // --- Core Data Handling & UI Updates ---

    /** Fetches token definitions from Firebase `/tokens`. Crucial for app functionality. */
    async function fetchAvailableTokens() {
        if (!db) { throw new Error("Database not initialized for fetchAvailableTokens."); }
        console.log("Fetching token definitions...");
        try {
            const snapshot = await db.ref('tokens').once('value');
            availableTokens = snapshot.val() || {};
            if (Object.keys(availableTokens).length === 0) {
                console.warn("No token definitions found in Firebase /tokens path.");
                // Show persistent warning if needed, but don't necessarily block app init
                 showTgAlert("Could not load essential token data. Swap/display features may be limited.", "Configuration Warning");
            } else {
                console.log(`Loaded ${Object.keys(availableTokens).length} token definitions.`);
            }
        } catch (error) {
            handleFirebaseError(error, "fetching token list");
            availableTokens = {}; // Reset on error
            throw error; // Re-throw as this might be a critical failure
        }
    }

    /** Updates the Home page portfolio and total balance display. */
    function updateHomePageUI() {
        if (!elements.assetListContainer || !elements.totalBalanceDisplay) {
             console.warn("Home page elements not found for UI update."); return;
        }
        console.log("Updating Home Portfolio UI");

        let totalValueUSD = 0;
        elements.assetListContainer.innerHTML = ''; // Clear previous list

        const heldSymbols = Object.keys(userBalances)
            .filter(symbol => userBalances[symbol] > 0.00000001 && availableTokens[symbol]) // Filter negligible amounts and ensure token def exists
            .sort((a, b) => {
                const valueA = (userBalances[a] || 0) * (availableTokens[a]?.priceUSD || 0);
                const valueB = (userBalances[b] || 0) * (availableTokens[b]?.priceUSD || 0);
                return valueB - valueA; // Sort descending by USD value
            });

        if (heldSymbols.length === 0) {
            elements.assetListContainer.innerHTML = '<p class="no-assets placeholder-text">Your held assets will appear here.</p>';
        } else {
            heldSymbols.forEach(symbol => {
                const balance = userBalances[symbol];
                const tokenInfo = availableTokens[symbol]; // We know this exists from filter
                const valueUSD = balance * (tokenInfo.priceUSD || 0);
                totalValueUSD += valueUSD;

                const card = document.createElement('div');
                card.className = 'asset-card card'; // Add card class
                // Use more specific formatting for display
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
                         <div class="value-usd">${symbol !== 'USD' ? formatCurrency(valueUSD) : ''}</div> <!-- Show USD value only for non-USD assets -->
                    </div>
                `;
                elements.assetListContainer.appendChild(card);
            });
        }
        // Update total balance display - remove '$' if formatCurrency adds it
        elements.totalBalanceDisplay.textContent = totalValueUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    /** Displays the current user's Telegram profile info. */
    function displayUserInfo() { /* ... (same as before) ... */ }
    /** Sets up the Receive page UI. */
    function setupReceivePage() { /* ... (same as before) ... */ }


    // --- Transaction History ---

    /** Fetches and displays recent transactions on the Home page. */
    async function fetchAndDisplayTransactions(limit = RECENT_TRANSACTIONS_LIMIT) { /* ... (same as before) ... */ }
    /** Creates an HTML element for a single transaction item. */
    function createTransactionElement(tx) { /* ... (same as before) ... */ }


    // --- Firebase Realtime Listeners ---

    /** Sets up the listener for realtime balance updates. */
    function setupBalanceListener() { /* ... (same as before, ensures single listener, updates UI based on active page) ... */ }
    // function setupTransactionListener() { /* ... (Optional: same as before) ... */ }


    // --- Firebase Initialization and User Setup ---

    /** Initializes Firebase, fetches tokens, loads/creates user, sets listeners. */
    async function initializeFirebaseAndUser() { /* ... (same as before, ensures correct order and error handling) ... */ }
    /** Disables core interactive elements on critical error. */
    function disableAppFeatures() { /* ... (same as before) ... */ }


    // --- Swap Functionality (Client-Side Simulation) ---

    /** Opens the token selection modal. */
    function openTokenModal(selectorType) { /* ... (same as before) ... */ }
    /** Closes the token selection modal. */
    function closeTokenModal() { /* ... (same as before) ... */ }
    /** Populates the token list in the modal. */
    function populateTokenListModal(searchTerm = '') { /* ... (same as before, includes disabling selection of other token) ... */ }
    /** Handles token selection from the modal. */
    function handleTokenSelection(selectedSymbol) { /* ... (same as before) ... */ }
    /** Updates the UI of a token selector button. */
    function updateTokenButtonUI(buttonElement, tokenSymbol) { /* ... (same as before) ... */ }
    /** Updates the 'Balance:' display under swap inputs. */
    function updateSwapBalancesUI() { /* ... (same as before) ... */ }
    /** Sets default 'from'/'to' tokens for swap. */
    function populateTokenSelectors() { /* ... (same as before) ... */ }
    /** Calculates the base swap rate from token prices (NEEDS secure source in production). */
    function calculateSwapRate() { /* ... (same as before) ... */ }
    /** Calculates the final 'to' amount including the swap fee. */
    function calculateSwapAmounts() { /* ... (same as before) ... */ }
    /** Debounced wrapper for calculateSwapAmounts. */
    const debouncedCalculateSwapAmounts = debounce(calculateSwapAmounts, DEBOUNCE_DELAY);
    /** Handles input changes in the 'from' amount field. */
    function handleFromAmountChange() { /* ... (same as before) ... */ }
    /** Switches 'from' and 'to' tokens and attempts to preserve value. */
    function switchSwapTokens() { /* ... (same as before) ... */ }
    /** Validates all swap inputs and enables/disables the swap button. */
    function validateSwapInput() { /* ... (same as before) ... */ }
    /** Updates all UI elements on the swap page based on current swapState. */
    function updateSwapUI() { /* ... (same as before) ... */ }

    /** Executes the swap (INSECURE CLIENT-SIDE SIMULATION). */
    async function executeSwap() {
        // WARNING: INSECURE - REQUIRES BACKEND IMPLEMENTATION FOR PRODUCTION
        if (isProcessingAction) { console.warn("Action already in progress."); return; } // Prevent double clicks
        if (!userDbRef || !currentUser || !db || !elements.executeSwapButton || elements.executeSwapButton.disabled) {
            console.warn("Swap execution prevented."); return;
        }

        const { fromToken, toToken, fromAmount, toAmount, rate } = swapState;
        const currentFromBalance = userBalances[fromToken] || 0;

        // Final validation
        if (!fromToken || !toToken || fromAmount <= MIN_SEND_AMOUNT || toAmount <= 0 || currentFromBalance < fromAmount) {
            showTgAlert("Swap details are invalid or you have insufficient balance.", "Swap Error");
            validateSwapInput(); return;
        }

        isProcessingAction = true; // Set flag
        console.log(`SIMULATING swap: ${fromAmount} ${fromToken} -> ${toAmount} ${toToken}`);
        showLoading("Processing Swap...");
        elements.executeSwapButton.disabled = true; // Disable immediately
        setStatusMessage(elements.swapStatus, 'Processing...', 'pending');

        // *** START OF INSECURE CLIENT-SIDE LOGIC ***
        const newFromBalance = currentFromBalance - fromAmount;
        const currentToBalance = userBalances[toToken] || 0;
        const newToBalance = currentToBalance + toAmount;

        const updates = {};
        const userId = currentUser.id.toString();
        updates[`/users/${userId}/balances/${fromToken}`] = sanitizeFloat(newFromBalance.toFixed(PRECISION));
        updates[`/users/${userId}/balances/${toToken}`] = sanitizeFloat(newToBalance.toFixed(PRECISION));

        const txData = { /* ... tx details ... */ status: 'completed' }; // Demo status
        const newTxKey = db.ref(`/transactions/${userId}`).push().key;
        if (newTxKey) { updates[`/transactions/${userId}/${newTxKey}`] = txData; }
        else { console.error("Failed to generate swap transaction key!"); }

        try {
            await db.ref().update(updates); // SIMULATED update
            console.log("Swap successful (simulated).");
            setStatusMessage(elements.swapStatus, 'Swap Successful!', 'success');
            // Reset form fields after successful simulation
            setTimeout(() => {
                swapState.fromAmount = 0; swapState.toAmount = 0; updateSwapUI();
                setStatusMessage(elements.swapStatus, ''); // Clear status
            }, 2500);
        } catch (error) {
            handleFirebaseError(error, "executing swap simulation");
            setStatusMessage(elements.swapStatus, 'Swap Failed.', 'error');
            validateSwapInput(); // Re-enable button if validation passes now
        } finally {
            hideLoading();
            isProcessingAction = false; // Clear flag
        }
        // *** END OF INSECURE CLIENT-SIDE LOGIC ***
    }

    /** Prepares the swap page UI. */
    function setupSwapPage() {
        console.log("Setting up Swap Page");
        swapState.fromAmount = 0; swapState.toAmount = 0;
        if (elements.swapFromAmountInput) elements.swapFromAmountInput.value = '';
        if (elements.swapToAmountInput) elements.swapToAmountInput.value = '';
        if (Object.keys(availableTokens).length > 0) { populateTokenSelectors(); }
        calculateSwapRate();
        setStatusMessage(elements.swapStatus, ''); // Clear previous status
        if(elements.executeSwapButton) elements.executeSwapButton.disabled = true; // Start disabled
    }


    // --- Internal Send Functionality (Client-Side Simulation) ---

    /** Populates the asset dropdown on the Send page. */
    function updateWithdrawAssetSelector() { /* ... */ }
    /** Updates the 'Available' balance display on the Send page. */
    function updateWithdrawPageBalance() { /* ... */ }
    /** Validates inputs on the Send page. */
    function validateSendInput() { /* ... */ }

    /** Executes the internal transfer (INSECURE CLIENT-SIDE SIMULATION). */
    async function handleSend() {
        // WARNING: INSECURE - REQUIRES BACKEND IMPLEMENTATION FOR PRODUCTION
         if (isProcessingAction) { console.warn("Action already in progress."); return; }
         if (!userDbRef || !currentUser || !db || !elements.sendButton || elements.sendButton.disabled) return;

        const selectedSymbol = elements.withdrawAssetSelect?.value;
        const recipientId = sanitizeInt(elements.withdrawRecipientIdInput?.value);
        const amount = sanitizeFloat(elements.withdrawAmountInput?.value);
        const senderId = currentUser.id;
        const senderBalance = userBalances[selectedSymbol] || 0;

        // Final validation
        if (!selectedSymbol || amount < MIN_SEND_AMOUNT || !recipientId || recipientId === senderId || senderBalance < amount) {
            showTgAlert("Invalid send details or insufficient funds.", "Send Error"); validateSendInput(); return;
        }

        isProcessingAction = true; // Set flag
        console.log(`SIMULATING send: ${amount} ${selectedSymbol} from ${senderId} to ${recipientId}`);
        showLoading("Processing Transfer...");
        elements.sendButton.disabled = true;
        setStatusMessage(elements.withdrawStatus, 'Verifying recipient...', 'pending');

        // *** START OF INSECURE CLIENT-SIDE LOGIC ***
        // 1. INSECURE Client-side recipient check
        const recipientRef = db.ref(`users/${recipientId}`);
        let recipientExists = false;
        try {
            const recipientSnapshot = await recipientRef.child('profile').once('value');
            recipientExists = recipientSnapshot.exists();
        } catch (error) { console.error("Error checking recipient:", error); /* Handle */ }

        if (!recipientExists) {
            hideLoading(); isProcessingAction = false;
            setStatusMessage(elements.withdrawStatus, 'Recipient Chat ID not found.', 'error');
            validateSendInput(); return;
        }

        setStatusMessage(elements.withdrawStatus, 'Processing transfer...', 'pending');

        // 2. INSECURE Client-side balance calculation and update preparation
        const updates = {};
        const senderBalancePath = `/users/${senderId}/balances/${selectedSymbol}`;
        const recipientBalancePath = `/users/${recipientId}/balances/${selectedSymbol}`;
        let recipientCurrentBalance = 0;
        try { // Fetch recipient balance just before write (still risky)
            const recipBalanceSnapshot = await recipientRef.child(`balances/${selectedSymbol}`).once('value');
            recipientCurrentBalance = sanitizeFloat(recipBalanceSnapshot.val());
        } catch (e) { console.warn("Could not reliably read recipient balance before update", e); }

        const newSenderBalance = senderBalance - amount;
        const newRecipientBalance = recipientCurrentBalance + amount;

        updates[senderBalancePath] = sanitizeFloat(newSenderBalance.toFixed(PRECISION));
        updates[recipientBalancePath] = sanitizeFloat(newRecipientBalance.toFixed(PRECISION));

        // 3. Log transaction
        const txId = db.ref(`/transactions/${senderId}`).push().key;
        const timestamp = firebase.database.ServerValue.TIMESTAMP;
        if (txId) { /* ... create senderTx and receiverTx logs ... */ }
        else { console.error("Failed to generate TX ID!"); }

        // 4. SIMULATING the database update
        try {
            await db.ref().update(updates);
            console.log("Internal transfer successful (simulated).");
            setStatusMessage(elements.withdrawStatus, 'Funds Sent Successfully!', 'success');
            if(elements.withdrawAmountInput) elements.withdrawAmountInput.value = '';
            if(elements.withdrawRecipientIdInput) elements.withdrawRecipientIdInput.value = '';
             // Don't clear status immediately, let the timeout handle it
        } catch (error) {
            handleFirebaseError(error, "executing internal transfer");
            setStatusMessage(elements.withdrawStatus, 'Send Failed.', 'error');
            validateSendInput(); // Re-validate button state
        } finally {
            hideLoading();
            isProcessingAction = false; // Clear flag
        }
        // *** END OF INSECURE CLIENT-SIDE LOGIC ***
    }

    /** Prepares the Send page UI. */
    function setupSendPage() {
         console.log("Setting up Send Page");
         if(elements.withdrawAssetSelect) updateWithdrawAssetSelector();
         if(elements.withdrawAmountInput) elements.withdrawAmountInput.value = '';
         if(elements.withdrawRecipientIdInput) elements.withdrawRecipientIdInput.value = '';
         setStatusMessage(elements.withdrawStatus, ''); // Clear status
         updateWithdrawPageBalance(); // Includes initial validation
         if(elements.sendButton) elements.sendButton.disabled = true; // Start disabled
    }


    // --- Event Listeners Setup ---
    /** Attaches all necessary event listeners for the application. */
    function setupEventListeners() { /* ... (same as before, ensures listeners are attached correctly) ... */ }


    // --- App Initialization ---
    /** Main function to initialize and start the AB Wallet application. */
    async function startApp() {
        console.log("Starting AB Wallet Application vX.Y.Z..."); // Add version if useful
        showLoading("Initializing...");
        try {
            // Setup Telegram WebApp environment
            await tg.ready();
            tg.expand();
            tg.enableClosingConfirmation();
            console.log("Telegram WebApp SDK Ready.");

            // Apply basic theme settings from Telegram
            // CSS handles the dark theme primarily, these are overrides/fallbacks
            document.body.style.setProperty('--tg-theme-bg-color', tg.themeParams.bg_color || '#16181a');
            document.body.style.setProperty('--tg-theme-text-color', tg.themeParams.text_color || '#e8e8e8');

            // Attach event listeners
            setupEventListeners();

            // Get Telegram User Data (CRITICAL STEP)
            if (tg.initDataUnsafe?.user?.id) {
                currentUser = tg.initDataUnsafe.user;
                console.log(`User Identified: ${currentUser.id}`);
                displayUserInfo(); // Show basic info immediately

                // Initialize Firebase App & Database connection
                if (!firebase.apps.length) { firebaseApp = firebase.initializeApp(firebaseConfig); }
                else { firebaseApp = firebase.app(); }
                db = firebase.database();
                if(!db) throw new Error("Firebase Database initialization failed.");
                console.log("Firebase Initialized.");

                // Fetch Tokens FIRST
                await fetchAvailableTokens();

                // Initialize User Data (Profile, Balances) and Setup Listeners
                await initializeFirebaseAndUser();

                // Show the initial page (Home) - this triggers its data loading
                showPage('home-page');

            } else { throw new Error("Could not retrieve valid Telegram user data."); }

            hideLoading(); // Success!
            console.log("AB Wallet Initialized Successfully.");

        } catch (error) {
            console.error("CRITICAL INITIALIZATION FAILURE:", error);
            handleFirebaseError(error, "App Initialization");
            showLoading("Error Loading Wallet");
            disableAppFeatures();
            if(elements.mainContent) elements.mainContent.innerHTML = `<div class="card status-message error init-error">Failed to initialize AB Wallet.<br>Please close and reopen.<br><small>(${error.message || 'Unknown error'})</small></div>`;
        }
    }

    // Start the application initialization process
    startApp();

}); // End DOMContentLoaded
