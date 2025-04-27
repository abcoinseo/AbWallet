document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration ---
    const firebaseConfig = {
        apiKey: "AIzaSyBW1WPXUN8DYhT6npZQYoQ3l4J-jFSbzfg", // USE RULES! SECURE YOUR KEYS/RULES!
        authDomain: "ab-studio-marketcap.firebaseapp.com",
        databaseURL: "https://ab-studio-marketcap-default-rtdb.firebaseio.com",
        projectId: "ab-studio-marketcap",
        storageBucket: "ab-studio-marketcap.firebasestorage.app",
        messagingSenderId: "115268088088",
        appId: "1:115268088088:web:65643a047f92bfaa66ee6d"
    };

    // --- Globals ---
    const tg = window.Telegram.WebApp;
    let currentUser = null;
    let userBalances = {};
    let availableTokens = {};
    let firebaseApp = null;
    let db = null;
    let userDbRef = null;
    let balanceListenerAttached = false;
    const SWAP_FEE_PERCENT = 0.1; // 0.1% swap fee

    // Swap state
    let swapState = { fromToken: null, toToken: null, fromAmount: 0, toAmount: 0, rate: 0, isRateLoading: false };
    let activeTokenSelector = null; // 'from' or 'to'

    // --- DOM Elements ---
    const loadingOverlay = document.getElementById('loading-overlay');
    const pages = document.querySelectorAll('.page');
    const navButtons = document.querySelectorAll('#bottom-nav .nav-button');
    const backButtons = document.querySelectorAll('.back-button');
    const refreshButton = document.getElementById('refresh-button');
    // Home
    const userInfoDisplay = document.getElementById('user-info-display');
    const totalBalanceDisplay = document.getElementById('total-balance-display');
    const assetListContainer = document.getElementById('asset-list');
    // Receive (Deposit) Page
    const depositChatIdSpan = document.getElementById('deposit-chat-id');
    // Send (Withdraw) Page
    const withdrawAssetSelect = document.getElementById('withdraw-asset-select');
    const withdrawAvailableBalance = document.getElementById('withdraw-available-balance');
    const withdrawRecipientIdInput = document.getElementById('withdraw-recipient-id');
    const withdrawAmountInput = document.getElementById('withdraw-amount');
    const sendButton = document.getElementById('send-button');
    const withdrawMaxButton = document.getElementById('withdraw-max-button');
    const withdrawStatus = document.getElementById('withdraw-status');
    // Swap Page
    const swapFromAmountInput = document.getElementById('swap-from-amount');
    const swapToAmountInput = document.getElementById('swap-to-amount');
    const swapFromTokenButton = document.getElementById('swap-from-token-button');
    const swapToTokenButton = document.getElementById('swap-to-token-button');
    const swapFromBalance = document.getElementById('swap-from-balance');
    const swapToBalance = document.getElementById('swap-to-balance');
    const swapSwitchButton = document.getElementById('swap-switch-button');
    const swapRateDisplay = document.getElementById('swap-rate-display');
    const executeSwapButton = document.getElementById('execute-swap-button');
    const swapStatus = document.getElementById('swap-status');
    // Token Modal
    const tokenModal = document.getElementById('token-selector-modal');
    const tokenSearchInput = document.getElementById('token-search-input');
    const tokenListModal = document.getElementById('token-list-modal');
    const closeModalButton = tokenModal?.querySelector('.close-modal-button');

    // --- Utility Functions ---
    const formatCurrency = (amount) => {
        const num = parseFloat(amount) || 0;
        return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    const formatTokenAmount = (amount, decimals = 6) => {
         const num = parseFloat(amount) || 0;
         // Adjust decimals based on value for readability, or use fixed high precision
         const effectiveDecimals = num > 0 && num < 0.01 ? Math.max(decimals, 4) : (num > 1000 ? 2 : decimals);
         return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: effectiveDecimals });
    };
    const sanitizeFloat = (value) => parseFloat(value) || 0;
    const sanitizeInt = (value) => parseInt(value, 10) || 0;
    const debounce = (func, delay) => {
        let timeoutId;
        return function(...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                func.apply(this, args);
            }, delay);
        };
    };

    // --- Loading & Alerts ---
    function showLoading(message = "Loading...") {
        if (!loadingOverlay) return;
        loadingOverlay.querySelector('p').textContent = message;
        loadingOverlay.classList.add('visible');
    }
    function hideLoading() {
        if (loadingOverlay) loadingOverlay.classList.remove('visible');
    }
    function showTgAlert(message, title = 'Info') { /* ... (same as before) ... */ }
    function handleFirebaseError(error, context = "Firebase operation") { /* ... (same as before, with PERMISSION_DENIED check) ... */ }


    // --- Navigation & Page Handling ---
    function showPage(pageId) { /* ... (same as before) ... */ }


    // --- Core Data Handling & UI Updates ---
    async function fetchAvailableTokens() {
        if (!db) return;
        console.log("Fetching available tokens...");
        try {
            const snapshot = await db.ref('tokens').once('value');
            availableTokens = snapshot.val() || {};
            console.log("Available tokens fetched:", Object.keys(availableTokens));
            // Populate UI elements that depend on tokens
            if (availableTokens && Object.keys(availableTokens).length > 0) {
                 populateTokenSelectors();
                 updateWithdrawAssetSelector();
            } else {
                console.warn("No tokens found in database.");
                // Show placeholder in selectors if needed
            }
        } catch (error) {
            handleFirebaseError(error, "fetching token list");
        }
    }

    function updateHomePageUI() {
        if (!assetListContainer || !totalBalanceDisplay) return;
        console.log("Updating Home Page UI");
        let totalValueUSD = 0;
        assetListContainer.innerHTML = ''; // Clear list

        const sortedSymbols = Object.keys(userBalances)
            .filter(symbol => userBalances[symbol] > 0.000001 && availableTokens[symbol]) // Ensure token definition exists
            .sort((a, b) => { /* ... sort by value descending ... */ });

        if (sortedSymbols.length === 0) {
            assetListContainer.innerHTML = '<p class="no-assets placeholder-text">No assets held.</p>';
        } else {
             sortedSymbols.forEach(symbol => { /* ... create and append asset card ... */ });
        }
        totalBalanceDisplay.textContent = formatCurrency(totalValueUSD);
    }

    function displayUserInfo() { /* ... (same as before) ... */ }

    function setupReceivePage() {
         if (depositChatIdSpan && currentUser) { /* ... (same as before) ... */ }
         else if (depositChatIdSpan) { depositChatIdSpan.textContent = 'N/A'; }
    }


    // --- Firebase Realtime Updates ---
    function setupBalanceListener() {
        if (!userDbRef || balanceListenerAttached) return;
        console.log("Setting up balance listener...");
        const balancesRef = userDbRef.child('balances');
        balancesRef.on('value', (snapshot) => {
            userBalances = snapshot.val() || {};
            console.log("Realtime balances received:", userBalances);
            // Update relevant UI sections based on active page
             const activePage = document.querySelector('.page.active');
             if(activePage) {
                 switch(activePage.id) {
                    case 'home-page': updateHomePageUI(); break;
                    case 'swap-page': updateSwapBalancesUI(); validateSwapInput(); break;
                    case 'withdraw-page': updateWithdrawPageBalance(); break; // This calls validateSendInput
                 }
             }
        }, (error) => {
            handleFirebaseError(error, "listening to balances");
            balanceListenerAttached = false;
        });
        balanceListenerAttached = true;
    }


    // --- Initialization ---
    async function initializeFirebaseAndUser() {
        showLoading("Initializing Wallet...");
        try {
            // Init Firebase App
            if (!firebase.apps.length) { firebaseApp = firebase.initializeApp(firebaseConfig); }
            else { firebaseApp = firebase.app(); }
            db = firebase.database();
            console.log("Firebase Initialized");

            // Ensure currentUser is available
            if (!currentUser || !currentUser.id) { throw new Error("Telegram user data not available."); }

            // Fetch tokens first as they are needed for UI population and logic
            await fetchAvailableTokens();

            const userId = currentUser.id.toString();
            userDbRef = db.ref('users/' + userId);

            // Check/Create user data
            const snapshot = await userDbRef.once('value');
            if (!snapshot.exists()) {
                console.log(`User ${userId} creating...`);
                const initialBalances = { USD: 0 }; // Default with 0 USD
                await userDbRef.set({
                    profile: { /* ... profile data ... */ createdAt: firebase.database.ServerValue.TIMESTAMP, lastLogin: firebase.database.ServerValue.TIMESTAMP },
                    balances: initialBalances
                });
                userBalances = initialBalances;
            } else {
                console.log(`User ${userId} found.`);
                const userData = snapshot.val();
                userBalances = userData.balances || { USD: 0 };
                 // Update profile silently
                 userDbRef.child('profile').update({ /* ... names, lastLogin ... */ });
            }

            // Attach balance listener AFTER initial data load/creation
            setupBalanceListener();

            // Perform initial UI population for the default page
            updateHomePageUI();
            hideLoading();
            console.log("Initialization Complete.");

        } catch (error) {
            handleFirebaseError(error, "Initialization");
            disableAppFeatures(); // Disable app if init fails critically
        }
    }

    function disableAppFeatures() { /* ... (disable buttons, show error message) ... */ }


    // --- Swap Functionality ---
    function openTokenModal(selectorType) { /* ... (show modal, set activeSelector) ... */ }
    function closeTokenModal() { /* ... (hide modal) ... */ }
    function populateTokenListModal(searchTerm = '') { /* ... (populate modal list based on availableTokens and search) ... */ }
    function handleTokenSelection(selectedSymbol) { /* ... (handle selection, prevent same tokens, update state, update UI) ... */ }
    function updateTokenButtonUI(buttonElement, tokenSymbol) { /* ... (update button visuals) ... */ }
    function updateSwapBalancesUI() { /* ... (update balance text under inputs) ... */ }
    function populateTokenSelectors() { /* ... (set default swap tokens if needed) ... */ }
    function calculateSwapRate() { /* ... (calculate BASE rate from prices) ... */ }
    function calculateSwapAmounts() { /* ... (calculate TO amount including fee based on BASE rate) ... */ }
    const debouncedCalculateSwapAmounts = debounce(calculateSwapAmounts, 300); // Debounce amount calculation
    function handleFromAmountChange() { swapState.fromAmount = sanitizeFloat(swapFromAmountInput.value); debouncedCalculateSwapAmounts(); } // Use debounced calculation
    function switchSwapTokens() { /* ... (switch tokens AND amounts, recalculate) ... */ }
    function validateSwapInput() { /* ... (check conditions, enable/disable executeSwapButton) ... */ }
    function updateSwapUI() { /* ... (update all swap related UI elements, calls validateSwapInput) ... */ }
    async function executeSwap() { /* ... (INSECURE client-side swap execution with fee logic and atomic update simulation) ... */ }
    function setupSwapPage() { /* ... (reset/setup swap page state and UI) ... */ }


    // --- Internal Send Functionality ---
    function updateWithdrawAssetSelector() { /* ... (populate asset dropdown) ... */ }
    function updateWithdrawPageBalance() { /* ... (update balance text based on selection) ... */ }
    function validateSendInput() { /* ... (validate all send inputs, enable/disable sendButton, show status) ... */ }
    async function handleSend() { /* ... (INSECURE client-side internal transfer execution with recipient check simulation and atomic update simulation) ... */ }
    function setupSendPage() { /* ... (reset/setup send page state and UI) ... */ }


    // --- Event Listeners ---
    function setupEventListeners() {
        console.log("Setting up event listeners...");
        // Navigation
        navButtons.forEach(button => button.addEventListener('click', () => { if(!button.classList.contains('active')) showPage(button.dataset.page); }));
        backButtons.forEach(button => button.addEventListener('click', () => showPage(button.dataset.target || 'home-page')));
        if(refreshButton) refreshButton.addEventListener('click', initializeFirebaseAndUser);

        // Swap Page
        if(swapFromAmountInput) swapFromAmountInput.addEventListener('input', handleFromAmountChange);
        if(swapSwitchButton) swapSwitchButton.addEventListener('click', switchSwapTokens);
        if(executeSwapButton) executeSwapButton.addEventListener('click', executeSwap);
        if(swapFromTokenButton) swapFromTokenButton.addEventListener('click', () => openTokenModal('from'));
        if(swapToTokenButton) swapToTokenButton.addEventListener('click', () => openTokenModal('to'));

        // Token Modal
        if (closeModalButton) closeModalButton.addEventListener('click', closeTokenModal);
        if (tokenSearchInput) tokenSearchInput.addEventListener('input', (e) => populateTokenListModal(e.target.value));
        if (tokenModal) tokenModal.addEventListener('click', (e) => { if (e.target === tokenModal) closeTokenModal(); }); // Click outside closes

        // Send Page
        if (withdrawAssetSelect) withdrawAssetSelect.addEventListener('change', updateWithdrawPageBalance);
        if (withdrawAmountInput) withdrawAmountInput.addEventListener('input', validateSendInput);
        if (withdrawRecipientIdInput) withdrawRecipientIdInput.addEventListener('input', validateSendInput);
        if (withdrawMaxButton) withdrawMaxButton.addEventListener('click', () => { /* ... set max amount ... */ });
        if (sendButton) sendButton.addEventListener('click', handleSend);
    }


    // --- Initialization ---
    function startApp() {
        console.log("Starting AB Wallet Application...");
        tg.ready(); // Inform Telegram Lib is ready
        tg.expand(); // Expand the Web App view
        tg.enableClosingConfirmation(); // Ask user before closing

        // Apply theme (though CSS sets dark by default now)
        document.body.style.backgroundColor = tg.themeParams.bg_color || '#1a1a1a'; // Use theme or default dark
        document.body.style.color = tg.themeParams.text_color || '#e0e0e0';

        // Setup Listeners Once
        setupEventListeners();

        // Get User Data & Initialize Firebase
        if (tg.initDataUnsafe?.user) {
            currentUser = tg.initDataUnsafe.user;
            console.log("User Initialized:", currentUser.id);
            displayUserInfo(); // Display basic info quickly
            initializeFirebaseAndUser(); // Load balances, tokens, etc.
        } else {
            console.error("Critical: Could not retrieve Telegram user data.");
            showTgAlert("Cannot load user data. Wallet is unavailable.", "Fatal Error");
            showLoading("Initialization Failed"); // Keep loading shown
             disableAppFeatures();
        }
        showPage('home-page'); // Show home page initially
    }

    // Start the app logic after DOM is ready
    startApp();

}); // End DOMContentLoaded
