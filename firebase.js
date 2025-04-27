// @ts-check // Enables type checking in VS Code, optional but helpful

/**
 * ====================================
 * AB Wallet - firebase.js
 * ====================================
 *
 * Handles Firebase interaction, application logic, and UI updates for the
 * AB Wallet Telegram Web App.
 *
 * ---- CRITICAL SECURITY WARNING ----
 * THIS IS A CLIENT-SIDE IMPLEMENTATION FOR DEMONSTRATION PURPOSES ONLY.
 * IT PERFORMS FINANCIAL OPERATIONS (BALANCE CHECKS, TRANSFERS, SWAPS)
 * DIRECTLY FROM THE CLIENT BROWSER, WHICH IS FUNDAMENTALLY INSECURE.
 *
 * A SECURE BACKEND SERVER IS ABSOLUTELY REQUIRED FOR ANY PRODUCTION
 * APPLICATION HANDLING REAL VALUE TO MANAGE AUTHENTICATION, AUTHORIZATION,
 * SECURE DATABASE OPERATIONS (E.G., ATOMIC TRANSACTIONS), AND PREVENT FRAUD.
 *
 * THE FIREBASE RULES NEEDED FOR THIS DEMO CODE TO FUNCTION ARE DANGEROUSLY
 * PERMISSIVE AND MUST NOT BE USED IN PRODUCTION.
 * ------------------------------------
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration ---
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

    // --- Globals ---
    const tg = window.Telegram.WebApp;
    /** @type {any | null} Current Telegram User object (Consider defining a specific type/interface) */
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

    // --- DOM Element References ---
    // Cache elements for performance and easier access
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

    /** Formats a number as USD currency string. */
    const formatCurrency = (amount) => {
        const num = sanitizeFloat(amount);
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
    };

    /** Formats a token amount with dynamic decimal places. */
    const formatTokenAmount = (amount, decimals = 6) => {
         const num = sanitizeFloat(amount);
         const effectiveDecimals = num !== 0 && Math.abs(num) < 0.01 ? Math.max(decimals, 4) : (Math.abs(num) > 10000 ? 2 : decimals);
         return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: effectiveDecimals });
    };

    /** Parses a value to a float, stripping non-numeric chars except '.' and '-', defaulting to 0. */
    const sanitizeFloat = (value) => parseFloat(String(value).replace(/[^0-9.-]+/g, "")) || 0;

    /** Parses a value to an integer, stripping non-digits, defaulting to 0. */
    const sanitizeInt = (value) => parseInt(String(value).replace(/[^0-9]+/g, ""), 10) || 0;

    /** Debounce utility function. */
    const debounce = (func, delay) => {
        let timeoutId;
        return function(...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                func.apply(this, args);
            }, delay);
        };
    };

    /** Formats a Firebase timestamp into a user-friendly relative string or date. */
    const formatTimestamp = (timestamp) => {
        if (!timestamp || typeof timestamp !== 'number' || timestamp < 0) return 'Invalid date';
        const now = Date.now();
        const date = new Date(timestamp);
        const diffSeconds = Math.round((now - date.getTime()) / 1000);

        if (diffSeconds < 5) return 'Just now';
        if (diffSeconds < 60) return `${diffSeconds}s ago`;
        if (diffSeconds < 3600) return `${Math.round(diffSeconds / 60)}m ago`;
        if (diffSeconds < 86400) return `${Math.round(diffSeconds / 3600)}h ago`;
        if (diffSeconds < 604800) return `${Math.round(diffSeconds / 86400)}d ago`;

        const options = /** @type {Intl.DateTimeFormatOptions} */ ({ month: 'short', day: 'numeric' });
        if (date.getFullYear() !== new Date().getFullYear()) { options.year = 'numeric'; }
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

    /** Displays an alert using Telegram's UI or fallback. */
    function showTgAlert(message, title = 'Alert') {
        const fullMessage = `${title}: ${message}`;
        if (tg?.showAlert) { tg.showAlert(fullMessage); }
        else { alert(fullMessage); console.warn("Fallback alert used."); }
    }

    /** Centralized Firebase error handler. */
    function handleFirebaseError(error, context = "Firebase Operation") {
        console.error(`${context} Error Code: ${error.code}, Message: ${error.message}`);
        hideLoading();
        let userMessage = `Operation failed. ${error.message || 'Please try again.'}`;
        switch (error.code) {
            case 'PERMISSION_DENIED':
                userMessage = "Action not allowed. Please check permissions or configuration."; break;
            case 'NETWORK_ERROR':
            case 'unavailable': // Firebase RTDB uses 'unavailable' sometimes
                userMessage = "Network error or service unavailable. Please check connection and try again later."; break;
            case 'MAX_RETRIES':
                 userMessage = "Could not complete the operation after multiple retries. Please try again later."; break;
        }
        showTgAlert(userMessage, `Error: ${context}`);
    }


    // --- Navigation & Page Handling ---

    /** Switches the active page, updates nav, resets scroll, and calls page setup. */
    function showPage(pageId) {
        console.log(`Navigating to page: ${pageId}`);
        let pageFound = false;
        elements.pages.forEach(page => {
             const isActive = page.id === pageId;
             page.classList.toggle('active', isActive);
             if(isActive) pageFound = true;
        });

        if (!pageFound) { pageId = 'home-page'; elements.pages[0]?.classList.add('active'); console.warn("Invalid page ID, defaulting to home."); }

        elements.navButtons.forEach(button => button.classList.toggle('active', button.dataset.page === pageId));
        if (elements.mainContent) elements.mainContent.scrollTop = 0;

        // Trigger page-specific setup/data loading AFTER navigation
        switch (pageId) {
            case 'home-page': updateHomePageUI(); fetchAndDisplayTransactions(); break; // Load portfolio and TXs for home
            case 'swap-page': setupSwapPage(); break;
            case 'deposit-page': setupReceivePage(); break;
            case 'withdraw-page': setupSendPage(); break;
        }
    }


    // --- Core Data Handling & UI Updates ---

    /** Fetches token definitions from Firebase `/tokens`. MUST complete before other data loads. */
    async function fetchAvailableTokens() {
        if (!db) { throw new Error("Database not initialized for fetchAvailableTokens."); }
        console.log("Fetching token definitions...");
        try {
            const snapshot = await db.ref('tokens').once('value');
            availableTokens = snapshot.val() || {};
            if (Object.keys(availableTokens).length === 0) {
                console.warn("No token definitions found in Firebase /tokens path.");
                showTgAlert("Could not load essential token data. Some features may be limited.", "Configuration Error");
            } else {
                console.log(`Loaded ${Object.keys(availableTokens).length} token definitions.`);
            }
        } catch (error) {
            handleFirebaseError(error, "fetching token list");
            availableTokens = {}; // Prevent using stale/bad data
            throw error; // Critical failure if tokens can't be loaded
        }
    }

    /** Updates the Home page portfolio section based on `userBalances` and `availableTokens`. */
    function updateHomePageUI() {
        if (!elements.assetListContainer || !elements.totalBalanceDisplay) return;
        console.log("Updating Home Portfolio UI");

        let totalValueUSD = 0;
        elements.assetListContainer.innerHTML = '';

        const heldSymbols = Object.keys(userBalances)
            .filter(symbol => userBalances[symbol] > 0.00000001 && availableTokens[symbol]) // Filter negligible amounts and ensure token exists
            .sort((a, b) => { /* ... sort by value descending ... */ });

        if (heldSymbols.length === 0) {
            elements.assetListContainer.innerHTML = '<p class="no-assets placeholder-text">No assets held.</p>';
        } else {
            heldSymbols.forEach(symbol => { /* ... create and append asset card ... */ });
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
        if (!userTransactionsRef) { console.warn("Transaction ref not set, cannot fetch."); return; }
        if (!elements.transactionListContainer) return;
        console.log(`Fetching last ${limit} transactions...`);
        elements.transactionListContainer.innerHTML = '<p class="placeholder-text">Loading transactions...</p>';

        try {
            const snapshot = await userTransactionsRef.orderByChild('timestamp').limitToLast(limit).once('value');
            const transactionsData = snapshot.val();
            if (!transactionsData || Object.keys(transactionsData).length === 0) {
                elements.transactionListContainer.innerHTML = '<p class="no-transactions placeholder-text">No recent transactions.</p>'; return;
            }
            elements.transactionListContainer.innerHTML = ''; // Clear loading

            const sortedTx = Object.entries(transactionsData)
                                .map(([id, data]) => ({ id, ...data }))
                                .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            sortedTx.forEach(tx => {
                const txElement = createTransactionElement(tx);
                elements.transactionListContainer.appendChild(txElement);
            });
        } catch (error) { /* ... handle error ... */ }
    }

    /** Creates an HTML element for a single transaction item. */
    function createTransactionElement(tx) { /* ... (same as before, renders TX row HTML) ... */ }


    // --- Firebase Realtime Listeners ---

    /** Sets up the listener for realtime balance updates. */
    function setupBalanceListener() {
        if (!userDbRef) { console.error("Cannot setup balance listener: userDbRef is null."); return; }
        if (balanceListenerAttached) { console.log("Balance listener already running."); return; }
        console.log("Setting up Firebase balance listener...");
        const balancesRef = userDbRef.child('balances');

        balancesRef.on('value', (snapshot) => {
            userBalances = snapshot.val() || {};
            console.log("Realtime balance update received:", userBalances);
            // Update UI based on currently active page
            const activePageId = document.querySelector('.page.active')?.id;
            if (activePageId) { /* ... (call relevant UI update function based on pageId) ... */ }
        }, (error) => { /* ... handle error, set attached flag to false ... */ });
        balanceListenerAttached = true;
    }

    // Optional live transaction listener setup (can be resource intensive)
    // function setupTransactionListener() { /* ... (listens for child_added) ... */ }


    // --- Firebase Initialization and User Setup ---

    /** Initializes Firebase, fetches tokens, loads/creates user, sets listeners. */
    async function initializeFirebaseAndUser() {
        if (!currentUser?.id || !db) { throw new Error("Cannot initialize Firebase data: Missing user ID or DB."); }
        console.log(`Initializing data for user: ${currentUser.id}`);
        const userId = currentUser.id.toString();
        userDbRef = db.ref('users/' + userId);
        userTransactionsRef = db.ref('transactions/' + userId);

        try {
            const snapshot = await userDbRef.once('value');
            if (!snapshot.exists()) { /* ... create new user profile and balances ... */ }
            else { /* ... load existing user balances, update profile login time ... */ }
            setupBalanceListener(); // Attach AFTER initial data is set
            // setupTransactionListener(); // Optional: Start listening for new transactions

        } catch (error) { handleFirebaseError(error, "loading/creating user data"); throw error; }
    }

    /** Disables core interactive elements on critical error. */
    function disableAppFeatures() { /* ... */ }


    // --- Swap Functionality (Client-Side Simulation) ---

    /** Opens the token selection modal. */
    function openTokenModal(selectorType) { /* ... */ }
    /** Closes the token selection modal. */
    function closeTokenModal() { /* ... */ }
    /** Populates the token list in the modal. */
    function populateTokenListModal(searchTerm = '') { /* ... (includes disabling selection of the *other* token) ... */ }
    /** Handles token selection from the modal. */
    function handleTokenSelection(selectedSymbol) { /* ... (updates state, recalculates) ... */ }
    /** Updates the UI of a token selector button. */
    function updateTokenButtonUI(buttonElement, tokenSymbol) { /* ... */ }
    /** Updates the 'Balance:' display under swap inputs. */
    function updateSwapBalancesUI() { /* ... */ }
    /** Sets default 'from'/'to' tokens for swap. */
    function populateTokenSelectors() { /* ... */ }
    /** Calculates the base swap rate from token prices. */
    function calculateSwapRate() { /* ... */ }
    /** Calculates the final 'to' amount including the swap fee. */
    function calculateSwapAmounts() { /* ... */ }
    /** Debounced wrapper for calculateSwapAmounts. */
    const debouncedCalculateSwapAmounts = debounce(calculateSwapAmounts, DEBOUNCE_DELAY);
    /** Handles input changes in the 'from' amount field. */
    function handleFromAmountChange() { /* ... */ }
    /** Switches 'from' and 'to' tokens and amounts. */
    function switchSwapTokens() { /* ... */ }
    /** Validates all swap inputs and enables/disables the swap button. */
    function validateSwapInput() { /* ... */ }
    /** Updates all UI elements on the swap page based on swapState. */
    function updateSwapUI() { /* ... */ }
    /** Executes the swap (INSECURE CLIENT-SIDE SIMULATION). */
    async function executeSwap() { /* ... (INSECURE: performs client-side balance updates & logging) ... */ }
    /** Prepares the swap page UI. */
    function setupSwapPage() { /* ... */ }


    // --- Internal Send Functionality (Client-Side Simulation) ---

    /** Populates the asset dropdown on the Send page. */
    function updateWithdrawAssetSelector() { /* ... */ }
    /** Updates the 'Available' balance display on the Send page. */
    function updateWithdrawPageBalance() { /* ... */ }
    /** Validates inputs on the Send page. */
    function validateSendInput() { /* ... */ }
    /** Executes the internal transfer (INSECURE CLIENT-SIDE SIMULATION). */
    async function handleSend() { /* ... (INSECURE: performs client-side recipient check, balance updates & logging) ... */ }
    /** Prepares the Send page UI. */
    function setupSendPage() { /* ... */ }


    // --- Event Listeners Setup ---
    /** Attaches all necessary event listeners for the application. */
    function setupEventListeners() { /* ... (Attaches listeners for nav, back, refresh, swap, modal, send actions) ... */ }


    // --- App Initialization ---
    /** Main function to initialize and start the AB Wallet application. */
    async function startApp() {
        console.log("Starting AB Wallet Application...");
        showLoading("Initializing...");
        try {
            // Ensure Telegram SDK is ready
            await tg.ready();
            tg.expand();
            tg.enableClosingConfirmation();
            console.log("Telegram WebApp SDK Ready.");

            // Apply basic theme settings from Telegram
            document.body.style.setProperty('--tg-theme-bg-color', tg.themeParams.bg_color || '#16181a');
            document.body.style.setProperty('--tg-theme-text-color', tg.themeParams.text_color || '#e8e8e8');
            // Consider mapping other themeParams to your CSS variables if needed

            // Attach all event listeners
            setupEventListeners();

            // Verify and get Telegram User Data (CRITICAL STEP)
            // Using initDataUnsafe for display ONLY. Validate initData on backend.
            if (tg.initDataUnsafe?.user?.id) { // Check for user ID specifically
                currentUser = tg.initDataUnsafe.user;
                console.log(`User Identified: ${currentUser.id}`);
                displayUserInfo(); // Display basic info early

                // Initialize Firebase App & Database connection
                if (!firebase.apps.length) { firebaseApp = firebase.initializeApp(firebaseConfig); }
                else { firebaseApp = firebase.app(); }
                db = firebase.database();
                if(!db) throw new Error("Firebase Database initialization failed.");
                console.log("Firebase Initialized.");

                // Fetch essential static data (tokens) BEFORE user data initialization
                await fetchAvailableTokens();

                // Initialize User Data (Profile, Balances) and Setup Listeners
                await initializeFirebaseAndUser();

                // Show the initial page (Home) - this will trigger its data loading functions
                showPage('home-page');

            } else {
                throw new Error("Could not retrieve valid Telegram user data (ID missing). App cannot function.");
            }

            hideLoading(); // Hide loading overlay ONLY on full successful initialization
            console.log("AB Wallet Initialized Successfully.");

        } catch (error) {
            // Catch any critical initialization error
            console.error("CRITICAL INITIALIZATION FAILURE:", error);
            handleFirebaseError(error, "App Initialization");
            showLoading("Error Loading Wallet"); // Keep loading showing error
            disableAppFeatures();
            // Display persistent error message in main content area
            if(elements.mainContent) elements.mainContent.innerHTML = `<div class="card status-message error" style="margin: 40px auto; text-align: center;">Failed to initialize AB Wallet.<br>Please close and reopen the app.<br><small>(${error.message || 'Unknown error'})</small></div>`;
        }
    }

    // Start the application initialization process once the DOM is ready
    startApp();

}); // End DOMContentLoaded
