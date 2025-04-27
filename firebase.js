// @ts-check

document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration ---
    // WARNING: Ensure Firebase rules are SECURE for production. DEMO uses insecure rules.
    const firebaseConfig = {
        apiKey: "AIzaSyBW1WPXUN8DYhT6npZQYoQ3l4J-jFSbzfg", // SECURE THIS VIA RULES/BACKEND
        authDomain: "ab-studio-marketcap.firebaseapp.com",
        databaseURL: "https://ab-studio-marketcap-default-rtdb.firebaseio.com",
        projectId: "ab-studio-marketcap",
        storageBucket: "ab-studio-marketcap.firebasestorage.app",
        messagingSenderId: "115268088088",
        appId: "1:115268088088:web:65643a047f92bfaa66ee6d"
    };

    // --- Constants ---
    const SWAP_FEE_PERCENT = 0.1;
    const DEBOUNCE_DELAY = 300;
    const PRECISION = 8; // For storing crypto balances
    const RECENT_TRANSACTIONS_LIMIT = 15;

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

    // Swap state
    let swapState = { fromToken: null, toToken: null, fromAmount: 0, toAmount: 0, rate: 0, isRateLoading: false };
    /** @type {'from' | 'to' | null} */
    let activeTokenSelector = null;

    // --- DOM Element References ---
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
    const formatCurrency = (amount) => { /* ... */ };
    const formatTokenAmount = (amount, decimals = 6) => { /* ... */ };
    const sanitizeFloat = (value) => parseFloat(String(value)) || 0;
    const sanitizeInt = (value) => parseInt(String(value), 10) || 0;
    const debounce = (func, delay) => { /* ... */ };
    const formatTimestamp = (timestamp) => { /* ... (formats time relatively) ... */ };

    // --- Loading & Alerts ---
    function showLoading(message = "Processing...") { /* ... */ }
    function hideLoading() { /* ... */ }
    function showTgAlert(message, title = 'Alert') { /* ... */ }
    function handleFirebaseError(error, context = "Firebase Operation") { /* ... */ }

    // --- Navigation & Page Handling ---
    function showPage(pageId) { /* ... (handles page switching & calls setup functions) ... */ }

    // --- Core Data Handling & UI Updates ---
    async function fetchAvailableTokens() { /* ... (fetches /tokens) ... */ }
    function updateHomePageUI() { /* ... (updates asset list and total balance) ... */ }
    function displayUserInfo() { /* ... */ }
    function setupReceivePage() { /* ... (displays user Chat ID) ... */ }

    // --- Transaction History ---
    async function fetchAndDisplayTransactions(limit = RECENT_TRANSACTIONS_LIMIT) {
         if (!userTransactionsRef || !elements.transactionListContainer) return;
         console.log(`Fetching last ${limit} transactions...`);
         elements.transactionListContainer.innerHTML = '<p class="placeholder-text">Loading transactions...</p>'; // Loading state

        try {
            // Fetch transactions ordered by timestamp, limited to the last N
            const snapshot = await userTransactionsRef.orderByChild('timestamp').limitToLast(limit).once('value');
            const transactionsData = snapshot.val();

            if (!transactionsData || Object.keys(transactionsData).length === 0) {
                elements.transactionListContainer.innerHTML = '<p class="no-transactions placeholder-text">No recent transactions.</p>';
                return;
            }
            elements.transactionListContainer.innerHTML = ''; // Clear loading/placeholder

            // Convert to array and sort descending (most recent first)
            const sortedTx = Object.entries(transactionsData)
                                .map(([id, data]) => ({ id, ...data }))
                                .sort((a, b) => b.timestamp - a.timestamp);

            sortedTx.forEach(tx => {
                const txElement = createTransactionElement(tx);
                elements.transactionListContainer.appendChild(txElement);
            });
        } catch (error) {
            handleFirebaseError(error, "fetching transactions");
             elements.transactionListContainer.innerHTML = '<p class="no-transactions placeholder-text error">Could not load transactions.</p>';
        }
    }

     function createTransactionElement(tx) {
        const div = document.createElement('div');
        div.className = 'transaction-item';
        div.dataset.txId = tx.id;

        let iconClass = 'tx-swap'; let iconName = 'swap_horiz';
        let infoText = ''; let amountText = ''; let counterpartyText = ''; let amountClass = '';

        switch (tx.type) {
            case 'send':
                iconClass = 'tx-send'; iconName = 'arrow_upward';
                amountText = `- ${formatTokenAmount(tx.amount, tx.token === 'USD' ? 2 : 6)}`;
                amountClass = 'tx-amount-negative';
                infoText = `Sent ${tx.token || '???'}`;
                counterpartyText = `To: ${tx.recipientId || 'Unknown'}`;
                break;
            case 'receive':
                iconClass = 'tx-receive'; iconName = 'arrow_downward';
                amountText = `+ ${formatTokenAmount(tx.amount, tx.token === 'USD' ? 2 : 6)}`;
                amountClass = 'tx-amount-positive';
                infoText = `Received ${tx.token || '???'}`;
                counterpartyText = `From: ${tx.senderId || 'Unknown'}`;
                break;
            case 'swap':
                iconClass = 'tx-swap'; iconName = 'swap_horiz';
                infoText = `Swap ${tx.fromToken} → ${tx.toToken}`;
                amountText = `-${formatTokenAmount(tx.fromAmount, tx.fromToken === 'USD' ? 2 : 6)} / +${formatTokenAmount(tx.toAmount, tx.toToken === 'USD' ? 2 : 6)}`;
                counterpartyText = `Rate ≈ ${formatTokenAmount(tx.baseRate, 6)}`; // Show base rate
                break;
            default: iconName = 'receipt_long'; infoText = `Tx: ${tx.type || 'Unknown'}`; break;
        }

        const shortTxId = `#${tx.id.substring(tx.id.length - 6)}`; // Shorter ID display

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
    function setupBalanceListener() { /* ... (same as before) ... */ }
    function setupTransactionListener() { /* ... (Optional: same as before, for live TX updates) ... */ }

    // --- Firebase Initialization and User Setup ---
    async function initializeFirebaseAndUser() {
        if (!currentUser?.id || !db) { throw new Error("Cannot initialize Firebase: Missing user ID or DB."); }
        console.log(`Initializing data for user: ${currentUser.id}`);
        const userId = currentUser.id.toString();
        userDbRef = db.ref('users/' + userId);
        userTransactionsRef = db.ref('transactions/' + userId); // Set ref for transactions

        try {
            // Fetch/Create user profile and balances
            const snapshot = await userDbRef.once('value');
            if (!snapshot.exists()) { /* ... create user ... */ }
            else { /* ... load user data ... */ }
            setupBalanceListener(); // Attach balance listener
            // setupTransactionListener(); // Optional: Attach live TX listener

        } catch (error) { /* ... handle error ... */ }
    }

    function disableAppFeatures() { /* ... */ }


    // --- Swap Functionality ---
    // ... (openTokenModal, closeTokenModal, populateTokenListModal, handleTokenSelection,
    //      updateTokenButtonUI, updateSwapBalancesUI, populateTokenSelectors, calculateSwapRate,
    //      calculateSwapAmounts, debouncedCalculateSwapAmounts, handleFromAmountChange, switchSwapTokens,
    //      validateSwapInput, updateSwapUI, executeSwap [INSECURE SIMULATION], setupSwapPage) ...
    //      (All these functions remain logically the same as the previous complete firebase.js version)


    // --- Internal Send Functionality ---
    // ... (updateWithdrawAssetSelector, updateWithdrawPageBalance, validateSendInput,
    //      handleSend [INSECURE SIMULATION], setupSendPage) ...
    //      (All these functions remain logically the same as the previous complete firebase.js version)


    // --- Event Listeners Setup ---
    function setupEventListeners() { /* ... (Attaches all listeners: nav, back, refresh, swap, modal, send) ... */ }


    // --- App Initialization ---
    async function startApp() {
        console.log("Starting AB Wallet Application...");
        showLoading("Initializing...");
        try {
            // Setup TG WebApp
            await tg.ready();
            tg.expand();
            tg.enableClosingConfirmation();
            document.body.style.backgroundColor = tg.themeParams.bg_color || '#16181a'; // Match CSS default
            document.body.style.color = tg.themeParams.text_color || '#e8e8e8';

            // Setup Listeners
            setupEventListeners();

            // Get User Data
            if (tg.initDataUnsafe?.user) {
                currentUser = tg.initDataUnsafe.user;
                console.log("User Data obtained:", currentUser.id);
                displayUserInfo();

                // Initialize Firebase
                if (!firebase.apps.length) { firebaseApp = firebase.initializeApp(firebaseConfig); }
                else { firebaseApp = firebase.app(); }
                db = firebase.database();
                console.log("Firebase App Initialized");

                // Fetch Tokens & User Data (Crucial Order)
                await fetchAvailableTokens(); // Need tokens before user init might need them
                await initializeFirebaseAndUser(); // Loads balances, sets listeners

                // Initial Page Load - Explicitly call showPage for home to trigger transaction load
                showPage('home-page');

            } else { throw new Error("Could not retrieve Telegram user data."); }

            hideLoading(); // Success! Hide loader.
            console.log("AB Wallet Initialized Successfully.");

        } catch (error) {
            console.error("Critical Initialization Error:", error);
            handleFirebaseError(error, "App Initialization");
            showLoading("Error Loading Wallet");
            disableAppFeatures();
            if(elements.mainContent) elements.mainContent.innerHTML = `<div class="card status-message error">Failed to initialize AB Wallet. Please restart the app. (${error.message || ''})</div>`;
        }
    }

    // Start the application
    startApp();

}); // End DOMContentLoaded
