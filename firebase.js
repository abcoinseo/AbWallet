// @ts-check

/**
 * ====================================
 * AB Wallet - firebase.js (Client-Side Simulation)
 * ====================================
 *
 * Handles UI logic, data display, input validation, and SIMULATES
 * interactions for the AB Wallet Telegram Web App.
 *
 * ---- CRITICAL SECURITY WARNING ----
 * THIS CODE IS A CLIENT-SIDE DEMONSTRATION ONLY. IT IS **NOT SECURE**
 * FOR HANDLING REAL VALUE. Financial operations (transfers, swaps,
 * balance checks) are SIMULATED here but MUST be implemented and
 * validated on a SECURE BACKEND SERVER in a real application.
 * Do not deploy this client-side logic for production use involving assets.
 * ------------------------------------
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration ---
    // WARNING: Ensure Firebase rules are SECURE for production. DEMO requires insecure rules to function.
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
    const SWAP_FEE_PERCENT = 0.1;
    const DEBOUNCE_DELAY = 350;
    const PRECISION = 8;
    const RECENT_TRANSACTIONS_LIMIT = 20;

    // --- Globals ---
    const tg = window.Telegram.WebApp;
    /** @type {any | null} */
    let currentUser = null;
    /** @type {Object.<string, number>} */
    let userBalances = {};
    /** @type {Object.<string, {name: string, symbol: string, priceUSD: number, logoUrl: string}>} */
    let availableTokens = {};
    /** @type {firebase.app.App | null} */
    let firebaseApp = null;
    /** @type {firebase.database.Database | null} */
    let db = null;
    /** @type {firebase.database.Reference | null} */
    let userDbRef = null;
    /** @type {firebase.database.Reference | null} */
    let userTransactionsRef = null;
    /** @type {boolean} */
    let balanceListenerAttached = false;
    /** @type {Function | null} */
    let transactionListenerDetacher = null;

    let swapState = { fromToken: null, toToken: null, fromAmount: 0, toAmount: 0, rate: 0, isRateLoading: false };
    /** @type {'from' | 'to' | null} */
    let activeTokenSelector = null;

    // --- DOM Element References ---
    // (Ensures all elements used in the script are referenced here)
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
        swapFromTokenButton: document.getElementById('swap-from-token-button'),
        swapToTokenButton: document.getElementById('swap-to-token-button'),
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
    const formatCurrency = (amount) => { /* ... */ };
    const formatTokenAmount = (amount, decimals = 6) => { /* ... */ };
    const sanitizeFloat = (value) => parseFloat(String(value).replace(/[^0-9.-]+/g, "")) || 0;
    const sanitizeInt = (value) => parseInt(String(value).replace(/[^0-9]+/g, ""), 10) || 0;
    const debounce = (func, delay) => { /* ... */ };
    const formatTimestamp = (timestamp) => { /* ... */ };

    // --- Loading & Alerts ---
    function showLoading(message = "Processing...") { /* ... */ }
    function hideLoading() { /* ... */ }
    function showTgAlert(message, title = 'Alert') { /* ... */ }
    function handleFirebaseError(error, context = "Firebase Operation") { /* ... (Improved error reporting) ... */ }

    // --- Navigation & Page Handling ---
    function showPage(pageId) { /* ... (Handles page switching, calls setup functions) ... */ }

    // --- Core Data Handling & UI Updates ---
    async function fetchAvailableTokens() { /* ... (Fetches /tokens definitions) ... */ }
    function updateHomePageUI() { /* ... (Updates asset list and total balance) ... */ }
    function displayUserInfo() { /* ... (Displays Telegram user info) ... */ }
    function setupReceivePage() { /* ... (Displays user's Chat ID) ... */ }

    // --- Transaction History ---
    async function fetchAndDisplayTransactions(limit = RECENT_TRANSACTIONS_LIMIT) { /* ... (Fetches and renders recent TXs) ... */ }
    function createTransactionElement(tx) { /* ... (Creates HTML for a TX item) ... */ }

    // --- Firebase Realtime Listeners ---
    function setupBalanceListener() { /* ... (Listens to balance changes, updates relevant UI) ... */ }
    // function setupTransactionListener() { /* ... (Optional: Listens for new TXs) ... */ }

    // --- Firebase Initialization and User Setup ---
    async function initializeFirebaseAndUser() { /* ... (Checks/creates user profile/balances, sets refs, calls listeners) ... */ }
    function disableAppFeatures() { /* ... (Disables buttons etc. on critical error) ... */ }


    // --- Swap Functionality (Client-Side Simulation) ---

    function openTokenModal(selectorType) { /* ... */ }
    function closeTokenModal() { /* ... */ }
    function populateTokenListModal(searchTerm = '') { /* ... */ }
    function handleTokenSelection(selectedSymbol) { /* ... */ }
    function updateTokenButtonUI(buttonElement, tokenSymbol) { /* ... */ }
    function updateSwapBalancesUI() { /* ... */ }
    function populateTokenSelectors() { /* ... (Sets default tokens) ... */ }
    function calculateSwapRate() { /* ... (Uses availableTokens[token].priceUSD - Needs backend for real prices) ... */ }
    function calculateSwapAmounts() { /* ... (Applies fee, updates swapState.toAmount) ... */ }
    const debouncedCalculateSwapAmounts = debounce(calculateSwapAmounts, DEBOUNCE_DELAY);
    function handleFromAmountChange() { /* ... (Updates swapState.fromAmount, calls debounced calc) ... */ }
    function switchSwapTokens() { /* ... (Swaps tokens/amounts, recalculates) ... */ }
    function validateSwapInput() { /* ... (Checks selections, amounts, *client-side* balance, enables/disables button) ... */ }
    function updateSwapUI() { /* ... (Updates all swap elements based on swapState, calls validation) ... */ }

    /**
     * Executes the swap operation (SIMULATED & INSECURE).
     * In a real app, this would send a request to a secure backend.
     */
    async function executeSwap() {
        // WARNING: INSECURE - Client-side balance manipulation. Requires Backend.
        if (!userDbRef || !currentUser || !db || !elements.executeSwapButton || elements.executeSwapButton.disabled) {
            console.warn("Swap execution prevented."); return;
        }

        const { fromToken, toToken, fromAmount, toAmount, rate } = swapState;
        const currentFromBalance = userBalances[fromToken] || 0; // Get current balance from state

        // Final validation before SIMULATING the write
        if (!fromToken || !toToken || fromAmount <= 0 || toAmount <= 0 || currentFromBalance < fromAmount) {
            showTgAlert("Swap details are invalid or you have insufficient balance.", "Swap Error");
            validateSwapInput(); // Re-check button state
            return;
        }

        console.log(`SIMULATING swap: ${fromAmount} ${fromToken} -> ${toAmount} ${toToken}`);
        showLoading("Processing Swap...");
        elements.executeSwapButton.disabled = true;
        if (elements.swapStatus) { elements.swapStatus.textContent = 'Processing...'; elements.swapStatus.className = 'status-message pending'; }

        // *** START OF INSECURE CLIENT-SIDE LOGIC ***
        // In a real app, send the following details to your backend:
        // { userId: currentUser.id, fromToken, toToken, fromAmount }
        // The backend would then validate, calculate the *actual* toAmount based on secure prices/logic,
        // apply fees, perform atomic database updates using Firebase Transactions, and log.

        const newFromBalance = currentFromBalance - fromAmount;
        const currentToBalance = userBalances[toToken] || 0;
        const newToBalance = currentToBalance + toAmount; // Using client-calculated 'toAmount'

        const updates = {};
        const userId = currentUser.id.toString();
        updates[`/users/${userId}/balances/${fromToken}`] = sanitizeFloat(newFromBalance.toFixed(PRECISION));
        updates[`/users/${userId}/balances/${toToken}`] = sanitizeFloat(newToBalance.toFixed(PRECISION));

        const txData = {
            type: 'swap', fromToken, fromAmount, toToken, toAmount, baseRate: rate,
            feePercent: SWAP_FEE_PERCENT, timestamp: firebase.database.ServerValue.TIMESTAMP, status: 'completed' // Status should be set by backend
        };
        const newTxKey = db.ref(`/transactions/${userId}`).push().key;
        if (newTxKey) { updates[`/transactions/${userId}/${newTxKey}`] = txData; }
        else { console.error("Failed to generate transaction key for swap log!"); }

        // SIMULATING the database update
        try {
            console.log("Attempting INSECURE client-side Firebase update:", updates);
            await db.ref().update(updates); // This requires insecure Firebase rules
            console.log("Swap successful (Client-side simulation).");
            if (elements.swapStatus) { elements.swapStatus.textContent = 'Swap Successful!'; elements.swapStatus.className = 'status-message success'; }
            // Reset form after success display
            setTimeout(() => {
                swapState.fromAmount = 0; swapState.toAmount = 0; updateSwapUI();
                if (elements.swapStatus) elements.swapStatus.textContent = '';
            }, 2500);
        } catch (error) {
            handleFirebaseError(error, "executing swap simulation");
            if (elements.swapStatus) { elements.swapStatus.textContent = 'Swap Failed.'; elements.swapStatus.className = 'status-message error'; }
            validateSwapInput(); // Re-enable button if validation passes now
        } finally {
            hideLoading();
        }
        // *** END OF INSECURE CLIENT-SIDE LOGIC ***
    }

    /** Prepares the swap page UI. */
    function setupSwapPage() {
        console.log("Setting up Swap Page");
        swapState.fromAmount = 0; swapState.toAmount = 0;
        if (elements.swapFromAmountInput) elements.swapFromAmountInput.value = '';
        if (elements.swapToAmountInput) elements.swapToAmountInput.value = '';
        if (Object.keys(availableTokens).length > 0) { populateTokenSelectors(); } // Ensure defaults are set
        calculateSwapRate(); // Calculate rate for current tokens
        if(elements.swapStatus) elements.swapStatus.textContent = '';
    }


    // --- Internal Send Functionality (Client-Side Simulation) ---

    /** Populates the asset dropdown on the Send page. */
    function updateWithdrawAssetSelector() { /* ... */ }
    /** Updates the 'Available' balance display on the Send page. */
    function updateWithdrawPageBalance() { /* ... */ }
    /** Validates inputs on the Send page. */
    function validateSendInput() { /* ... */ }

    /** Executes the internal transfer (SIMULATED & INSECURE). */
    async function handleSend() {
        // WARNING: INSECURE - Needs Backend for validation and atomic updates.
        if (!userDbRef || !currentUser || !db || !elements.sendButton || elements.sendButton.disabled) { return; }

        const selectedSymbol = elements.withdrawAssetSelect?.value;
        const recipientId = sanitizeInt(elements.withdrawRecipientIdInput?.value);
        const amount = sanitizeFloat(elements.withdrawAmountInput?.value);
        const senderId = currentUser.id;
        const senderBalance = userBalances[selectedSymbol] || 0;

        // Final client-side input validation
        if (!selectedSymbol || amount <= 0 || !recipientId || recipientId === senderId || senderBalance < amount) {
            showTgAlert("Invalid send details or insufficient funds.", "Send Error"); validateSendInput(); return;
        }

        console.log(`SIMULATING send: ${amount} ${selectedSymbol} from ${senderId} to ${recipientId}`);
        showLoading("Processing Transfer...");
        elements.sendButton.disabled = true;
        if (elements.withdrawStatus) { elements.withdrawStatus.textContent = 'Verifying recipient...'; elements.withdrawStatus.className = 'status-message pending'; }

        // *** START OF INSECURE CLIENT-SIDE LOGIC ***
        // In a real app, send { senderId: currentUser.id, recipientId, selectedSymbol, amount } to backend.
        // Backend verifies sender, recipient, balance, performs atomic update, logs.

        // 1. INSECURE Client-side recipient check
        const recipientRef = db.ref(`users/${recipientId}`);
        let recipientExists = false;
        try {
            const recipientSnapshot = await recipientRef.child('profile').once('value');
            recipientExists = recipientSnapshot.exists();
        } catch (error) { console.error("Error checking recipient:", error); /* Handle */ }

        if (!recipientExists) {
            hideLoading();
            if (elements.withdrawStatus) { elements.withdrawStatus.textContent = 'Recipient Chat ID not found.'; elements.withdrawStatus.className = 'status-message error'; }
            validateSendInput(); return;
        }

        if (elements.withdrawStatus) elements.withdrawStatus.textContent = 'Processing transfer...';

        // 2. INSECURE Client-side balance calculation and update preparation
        const updates = {};
        const senderBalancePath = `/users/${senderId}/balances/${selectedSymbol}`;
        const recipientBalancePath = `/users/${recipientId}/balances/${selectedSymbol}`;
        let recipientCurrentBalance = 0;
        try { // Attempt to get recipient balance (race condition risk)
            const recipBalanceSnapshot = await recipientRef.child(`balances/${selectedSymbol}`).once('value');
            recipientCurrentBalance = sanitizeFloat(recipBalanceSnapshot.val());
        } catch (e) { console.warn("Could not reliably read recipient balance before update", e); }

        const newSenderBalance = senderBalance - amount;
        const newRecipientBalance = recipientCurrentBalance + amount;

        updates[senderBalancePath] = sanitizeFloat(newSenderBalance.toFixed(PRECISION));
        updates[recipientBalancePath] = sanitizeFloat(newRecipientBalance.toFixed(PRECISION));

        // 3. Log transaction (also insecure if client can manipulate)
        const txId = db.ref(`/transactions/${senderId}`).push().key;
        const timestamp = firebase.database.ServerValue.TIMESTAMP;
        if (txId) {
             const senderTx = { type: 'send', token: selectedSymbol, amount, recipientId, timestamp, status: 'completed' };
             const receiverTx = { type: 'receive', token: selectedSymbol, amount, senderId, timestamp, status: 'completed' };
             updates[`/transactions/${senderId}/${txId}`] = senderTx;
             updates[`/transactions/${recipientId}/${txId}`] = receiverTx;
        } else { console.error("Failed to generate TX ID!"); }

        // 4. SIMULATING the database update
        try {
            console.log("Attempting INSECURE client-side Firebase update for send:", updates);
            await db.ref().update(updates); // Requires insecure Firebase rules
            console.log("Internal transfer successful (simulated).");
            if (elements.withdrawStatus) { elements.withdrawStatus.textContent = 'Funds Sent Successfully!'; elements.withdrawStatus.className = 'status-message success'; }
            if(elements.withdrawAmountInput) elements.withdrawAmountInput.value = '';
            if(elements.withdrawRecipientIdInput) elements.withdrawRecipientIdInput.value = '';
            setTimeout(() => { if (elements.withdrawStatus) elements.withdrawStatus.textContent = ''; }, 3000);
        } catch (error) { handleFirebaseError(error, "executing internal transfer"); if (elements.withdrawStatus) { elements.withdrawStatus.textContent = 'Send Failed.'; elements.withdrawStatus.className = 'status-message error'; }
        } finally { hideLoading(); validateSendInput(); } // Re-validate button state
        // *** END OF INSECURE CLIENT-SIDE LOGIC ***
    }

    /** Prepares the Send page UI. */
    function setupSendPage() { /* ... (Clears inputs, updates selector/balance, validates) ... */ }


    // --- Event Listeners Setup ---
    /** Attaches all necessary event listeners for the application. */
    function setupEventListeners() {
        console.log("Attaching event listeners...");
        // Navigation
        elements.navButtons.forEach(button => button.addEventListener('click', () => { if (!button.classList.contains('active')) showPage(button.dataset.page); }));
        elements.backButtons.forEach(button => button.addEventListener('click', () => showPage(button.dataset.target || 'home-page')));
        if (elements.refreshButton) elements.refreshButton.addEventListener('click', async () => {
            showLoading("Refreshing...");
            try {
                // Re-fetch dynamic data and update UI
                await fetchAvailableTokens(); // Refresh token defs/prices
                // Force UI updates based on current balance state (listener should handle actual balance fetch)
                const activePageId = document.querySelector('.page.active')?.id || 'home-page';
                showPage(activePageId); // This re-runs setup and data fetch for the current page
            } catch (error) { console.error("Refresh failed:", error); }
            finally { hideLoading(); }
        });
        // Swap Page
        if (elements.swapFromAmountInput) elements.swapFromAmountInput.addEventListener('input', handleFromAmountChange);
        if (elements.swapSwitchButton) elements.swapSwitchButton.addEventListener('click', switchSwapTokens);
        if (elements.executeSwapButton) elements.executeSwapButton.addEventListener('click', executeSwap);
        if (elements.swapFromTokenButton) elements.swapFromTokenButton.addEventListener('click', () => openTokenModal('from'));
        if (elements.swapToTokenButton) elements.swapToTokenButton.addEventListener('click', () => openTokenModal('to'));
        // Token Modal
        if (elements.closeModalButton) elements.closeModalButton.addEventListener('click', closeTokenModal);
        if (elements.tokenSearchInput) elements.tokenSearchInput.addEventListener('input', debounce((e) => populateTokenListModal(e.target.value), 250));
        if (elements.tokenModal) elements.tokenModal.addEventListener('click', (e) => { if (e.target === elements.tokenModal) closeTokenModal(); });
        // Send Page
        if (elements.withdrawAssetSelect) elements.withdrawAssetSelect.addEventListener('change', updateWithdrawPageBalance);
        if (elements.withdrawAmountInput) elements.withdrawAmountInput.addEventListener('input', debounce(validateSendInput, DEBOUNCE_DELAY));
        if (elements.withdrawRecipientIdInput) elements.withdrawRecipientIdInput.addEventListener('input', debounce(validateSendInput, DEBOUNCE_DELAY));
        if (elements.withdrawMaxButton) elements.withdrawMaxButton.addEventListener('click', () => { /* Max button logic */ });
        if (elements.sendButton) elements.sendButton.addEventListener('click', handleSend);
        console.log("Event listeners attached.");
    }


    // --- App Initialization ---
    /** Main function to initialize and start the AB Wallet application. */
    async function startApp() {
        console.log("Starting AB Wallet Application...");
        showLoading("Initializing...");
        try {
            // Setup Telegram WebApp environment
            await tg.ready();
            tg.expand();
            tg.enableClosingConfirmation();
            console.log("Telegram WebApp SDK Ready.");

            // Apply basic theme settings from Telegram
            document.body.style.setProperty('--tg-theme-bg-color', tg.themeParams.bg_color || '#16181a');
            document.body.style.setProperty('--tg-theme-text-color', tg.themeParams.text_color || '#e8e8e8');

            // Attach event listeners
            setupEventListeners();

            // Get Telegram User Data (Crucial)
            if (tg.initDataUnsafe?.user?.id) {
                currentUser = tg.initDataUnsafe.user;
                console.log(`User Identified: ${currentUser.id}`);
                displayUserInfo(); // Display user info early

                // Initialize Firebase App & DB
                if (!firebase.apps.length) { firebaseApp = firebase.initializeApp(firebaseConfig); }
                else { firebaseApp = firebase.app(); }
                db = firebase.database();
                if(!db) throw new Error("Firebase Database initialization failed.");
                console.log("Firebase Initialized.");

                // ORDER IS IMPORTANT: Fetch tokens first, then user data/listeners
                await fetchAvailableTokens();
                await initializeFirebaseAndUser();

                // Show initial page (triggers its data loading like transactions)
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

    // Start the application
    startApp();

}); // End DOMContentLoaded
