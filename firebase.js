// @ts-check // Enables type checking in VS Code, optional but helpful

document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration ---
    // WARNING: Ensure your Firebase project has appropriate security rules set up.
    // The rules required for THIS CLIENT-SIDE DEMO to function are INSECURE for production.
    const firebaseConfig = {
        apiKey: "AIzaSyBW1WPXUN8DYhT6npZQYoQ3l4J-jFSbzfg", // Replace with your actual key if needed
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

    // --- Globals ---
    const tg = window.Telegram.WebApp;
    /** @type {object | null} Current Telegram User object */
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
    /** @type {boolean} Flag to prevent attaching multiple balance listeners */
    let balanceListenerAttached = false;

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
    // Cache frequently accessed elements
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

    /** Formats a number as USD currency. */
    const formatCurrency = (amount) => {
        const num = parseFloat(amount) || 0;
        return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    };

    /** Formats a number representing a token amount with appropriate precision. */
    const formatTokenAmount = (amount, decimals = 6) => {
         const num = parseFloat(amount) || 0;
         const effectiveDecimals = num > 0 && num < 0.001 ? Math.max(decimals, 4) : (num > 10000 ? 2 : decimals);
         return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: effectiveDecimals });
    };

    /** Parses a string to a float, returning 0 if invalid. */
    const sanitizeFloat = (value) => parseFloat(String(value)) || 0;

    /** Parses a string to an integer, returning 0 if invalid. */
    const sanitizeInt = (value) => parseInt(String(value), 10) || 0;

    /** Debounce function to limit rapid execution (e.g., on input events). */
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
        if (tg?.showAlert) {
            tg.showAlert(fullMessage);
        } else {
            alert(fullMessage);
            console.warn("Telegram WebApp context unavailable for alert.");
        }
    }

    /** Handles Firebase errors, logs them, and shows an alert. */
    function handleFirebaseError(error, context = "Firebase Operation") {
        console.error(`${context} Error:`, error);
        hideLoading(); // Ensure loading is hidden on error
        let message = `Operation failed. ${error.message || 'Unknown error'}.`;
        if (error.code === 'PERMISSION_DENIED') {
            message = "Permission Denied. Check Firebase rules or app configuration.";
        } else if (error.code === 'NETWORK_ERROR' || error.message?.includes('network error')) {
            message = "Network connection issue. Please check your internet and try again.";
        }
        showTgAlert(message, `Error during ${context}`);
    }

    // --- Navigation & Page Handling ---

    /** Shows the specified page and hides others, updating navigation state. */
    function showPage(pageId) {
        console.log(`Navigating to: ${pageId}`);
        let pageFound = false;
        elements.pages.forEach(page => {
             const isActive = page.id === pageId;
             page.classList.toggle('active', isActive);
             if(isActive) pageFound = true;
        });

        // Fallback to home page if ID is invalid
        if (!pageFound) {
            console.warn(`Page "${pageId}" not found, defaulting to home.`);
            pageId = 'home-page';
            elements.pages[0]?.classList.add('active');
        }

        // Update nav button active state
        elements.navButtons.forEach(button => {
            button.classList.toggle('active', button.dataset.page === pageId);
        });

        // Reset scroll position of the main content area
        if (elements.mainContent) elements.mainContent.scrollTop = 0;

        // Call page-specific setup functions
        switch (pageId) {
            case 'home-page': updateHomePageUI(); break; // Refresh home data display
            case 'swap-page': setupSwapPage(); break;
            case 'deposit-page': setupReceivePage(); break;
            case 'withdraw-page': setupSendPage(); break;
        }
    }

    // --- Core Data Handling & UI Updates ---

    /** Fetches token definitions from Firebase database `/tokens`. */
    async function fetchAvailableTokens() {
        if (!db) { console.error("Database not initialized for fetchAvailableTokens."); return; }
        console.log("Fetching token definitions...");
        try {
            const snapshot = await db.ref('tokens').once('value');
            availableTokens = snapshot.val() || {};
            if (Object.keys(availableTokens).length === 0) {
                console.warn("No token definitions found in Firebase /tokens path.");
                showTgAlert("Could not load token information. Swapping may be unavailable.", "Configuration Error");
            } else {
                 console.log(`Loaded ${Object.keys(availableTokens).length} tokens.`);
                 // Now that tokens are loaded, populate dependent UI elements
                 populateTokenSelectors(); // For Swap page defaults
                 updateWithdrawAssetSelector(); // For Send page dropdown
            }
        } catch (error) {
            handleFirebaseError(error, "fetching token list");
            availableTokens = {}; // Reset on error
        }
    }

    /** Updates the portfolio display on the Home page. */
    function updateHomePageUI() {
        if (!elements.assetListContainer || !elements.totalBalanceDisplay) return;
        console.log("Updating Home UI with balances:", userBalances);

        let totalValueUSD = 0;
        elements.assetListContainer.innerHTML = ''; // Clear list

        // Filter symbols with positive balance AND existing token definition
        const heldSymbols = Object.keys(userBalances)
            .filter(symbol => userBalances[symbol] > 0.0000001 && availableTokens[symbol])
            .sort((a, b) => {
                const valueA = (userBalances[a] || 0) * (availableTokens[a]?.priceUSD || 0);
                const valueB = (userBalances[b] || 0) * (availableTokens[b]?.priceUSD || 0);
                return valueB - valueA; // Sort descending by value
            });

        if (heldSymbols.length === 0) {
            elements.assetListContainer.innerHTML = '<p class="no-assets placeholder-text">No assets held.</p>';
        } else {
            heldSymbols.forEach(symbol => {
                const balance = userBalances[symbol];
                const tokenInfo = availableTokens[symbol];
                const priceUSD = tokenInfo.priceUSD || 0;
                const valueUSD = balance * priceUSD;
                totalValueUSD += valueUSD;

                const card = document.createElement('div');
                card.className = 'asset-card card'; // Add card class for consistent styling
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
        elements.totalBalanceDisplay.textContent = formatCurrency(totalValueUSD).replace('$', ''); // Remove default $ sign if formatCurrency adds it
    }

    /** Displays the current user's information. */
    function displayUserInfo() {
        if (!elements.userInfoDisplay || !currentUser) return;
        const { first_name = '', last_name = '', username = null, id } = currentUser;
        const fullName = `${first_name} ${last_name}`.trim() || 'Unknown User';
        elements.userInfoDisplay.innerHTML = `
            <p><strong>Name:</strong> <span>${fullName}</span></p>
            <p><strong>Username:</strong> <span>${username ? '@' + username : 'Not Set'}</span></p>
            <p><strong>Chat ID:</strong> <span>${id}</span></p>
        `;
    }

    /** Sets up the Receive page UI. */
    function setupReceivePage() {
        if (elements.depositChatIdSpan && currentUser) {
            elements.depositChatIdSpan.textContent = currentUser.id.toString();
            // Ensure the copy button targets the correct element
            const copyBtn = elements.depositChatIdSpan.closest('.deposit-info-card')?.querySelector('.copy-button');
            if (copyBtn) copyBtn.dataset.clipboardText = currentUser.id.toString();
        } else if (elements.depositChatIdSpan) {
            elements.depositChatIdSpan.textContent = 'N/A';
        }
    }

    // --- Firebase Realtime Balance Listener ---

    /** Sets up the listener for realtime balance updates. */
    function setupBalanceListener() {
        if (!userDbRef || balanceListenerAttached) {
             if (balanceListenerAttached) console.log("Balance listener already attached.");
             else console.error("Cannot attach balance listener: userDbRef is null.");
             return;
        }
        console.log("Setting up Firebase balance listener...");
        const balancesRef = userDbRef.child('balances');

        balancesRef.on('value', (snapshot) => {
            userBalances = snapshot.val() || {}; // Update global state
            console.log("Realtime balance update received:", userBalances);

            // Update UI only if the relevant page is active
            const activePage = document.querySelector('.page.active');
            if (!activePage) return;

            switch (activePage.id) {
                case 'home-page': updateHomePageUI(); break;
                case 'swap-page': updateSwapBalancesUI(); validateSwapInput(); break;
                case 'withdraw-page': updateWithdrawPageBalance(); break; // This calls validateSendInput
            }
        }, (error) => {
            handleFirebaseError(error, "listening to balance changes");
            // Consider attempting to re-attach the listener after a delay or on next action
            balanceListenerAttached = false;
        });

        balanceListenerAttached = true;
        console.log("Firebase balance listener attached.");
    }


    // --- Firebase Initialization and User Setup ---

    /** Initializes Firebase connection and loads/creates user data. */
    async function initializeFirebaseAndUser() {
        if (!currentUser?.id) { throw new Error("Cannot initialize Firebase: Missing user ID."); }
        if (!db) { throw new Error("Cannot initialize Firebase: Database not initialized."); }

        console.log(`Initializing data for user: ${currentUser.id}`);
        const userId = currentUser.id.toString();
        userDbRef = db.ref('users/' + userId);

        try {
            const snapshot = await userDbRef.once('value');
            if (!snapshot.exists()) {
                // User doesn't exist, create them
                console.log(`User ${userId} not found in DB. Creating new user...`);
                const initialBalances = { USD: 0 }; // Start with 0 USD balance
                // You could add other default tokens here if needed: e.g., { USD: 0, ABT: 0 }
                const newUserProfile = {
                    telegram_id: currentUser.id,
                    first_name: currentUser.first_name || null,
                    last_name: currentUser.last_name || null,
                    username: currentUser.username || null,
                    createdAt: firebase.database.ServerValue.TIMESTAMP,
                    lastLogin: firebase.database.ServerValue.TIMESTAMP
                };
                await userDbRef.set({ profile: newUserProfile, balances: initialBalances });
                userBalances = initialBalances; // Set local state
                console.log("New user created successfully.");
            } else {
                // User exists, load data and update profile info
                console.log(`User ${userId} found in DB.`);
                const userData = snapshot.val();
                userBalances = userData.balances || { USD: 0 }; // Load balances or default
                // Update non-critical profile info silently
                userDbRef.child('profile').update({
                    first_name: currentUser.first_name || userData.profile?.first_name || null,
                    last_name: currentUser.last_name || userData.profile?.last_name || null,
                    username: currentUser.username || userData.profile?.username || null,
                    lastLogin: firebase.database.ServerValue.TIMESTAMP
                }).catch(err => console.warn("Non-critical error updating profile info:", err));
            }

            // Attach the realtime listener AFTER initial data load/creation
            setupBalanceListener();

        } catch (error) {
            handleFirebaseError(error, "loading/creating user data");
            throw error; // Re-throw to be caught by the main initialization block
        }
    }

    // --- Swap Functionality ---

    /** Opens the token selection modal for 'from' or 'to'. */
    function openTokenModal(selectorType) {
        if (!elements.tokenModal) return;
        activeTokenSelector = selectorType;
        populateTokenListModal(); // Refresh list
        if(elements.tokenSearchInput) elements.tokenSearchInput.value = ''; // Clear search
        elements.tokenModal.style.display = 'flex';
        if(elements.tokenSearchInput) elements.tokenSearchInput.focus();
    }

    /** Closes the token selection modal. */
    function closeTokenModal() {
        if (elements.tokenModal) elements.tokenModal.style.display = 'none';
        activeTokenSelector = null;
    }

    /** Populates the token list in the modal, filtering by search term. */
    function populateTokenListModal(searchTerm = '') {
        if (!elements.tokenListModal) return;
        elements.tokenListModal.innerHTML = ''; // Clear previous list
        const lowerSearchTerm = searchTerm.toLowerCase().trim();

        const filteredTokens = Object.values(availableTokens).filter(token =>
            token.name.toLowerCase().includes(lowerSearchTerm) ||
            token.symbol.toLowerCase().includes(lowerSearchTerm)
        );

        if (filteredTokens.length === 0) {
             elements.tokenListModal.innerHTML = '<li class="placeholder-text">No matching tokens found.</li>';
             return;
        }

        filteredTokens
            .sort((a, b) => a.name.localeCompare(b.name)) // Sort alphabetically
            .forEach(token => {
                const li = document.createElement('li');
                li.dataset.symbol = token.symbol;
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

    /** Handles the selection of a token from the modal. */
    function handleTokenSelection(selectedSymbol) {
        if (!activeTokenSelector || !selectedSymbol) return;

        // Prevent selecting the same token for both from and to - swap them instead
        if (activeTokenSelector === 'from' && selectedSymbol === swapState.toToken) {
            swapState.toToken = swapState.fromToken; // Old 'from' becomes new 'to'
            swapState.fromToken = selectedSymbol;   // Selected becomes new 'from'
        } else if (activeTokenSelector === 'to' && selectedSymbol === swapState.fromToken) {
            swapState.fromToken = swapState.toToken; // Old 'to' becomes new 'from'
            swapState.toToken = selectedSymbol;    // Selected becomes new 'to'
        } else {
            // Normal selection
            swapState[activeTokenSelector === 'from' ? 'fromToken' : 'toToken'] = selectedSymbol;
        }

        closeTokenModal();
        calculateSwapRate(); // Recalculate rate and amounts
    }

    /** Updates the visual representation of a token selector button. */
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
            logoElement.src = 'placeholder.png';
            logoElement.alt = '-';
            symbolElement.textContent = 'Select';
        }
    }

    /** Updates the balance displays below the swap input fields. */
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

    /** Sets default tokens for the swap interface if none are selected. */
    function populateTokenSelectors() {
        const symbols = Object.keys(availableTokens);
        if (!swapState.fromToken && symbols.includes('USD')) {
            swapState.fromToken = 'USD';
        } else if (!swapState.fromToken && symbols.length > 0) {
            swapState.fromToken = symbols[0]; // Fallback to first token
        }

        if (!swapState.toToken && symbols.length > 1) {
             // Find the first token that is not the 'fromToken'
            const defaultTo = symbols.find(s => s !== swapState.fromToken) || symbols[1];
            swapState.toToken = defaultTo;
        } else if (!swapState.toToken && swapState.fromToken && symbols.length === 1) {
             // Only one token available, cannot swap yet
             console.warn("Only one token type available, cannot set default 'to' token for swap.");
        }

        // Update UI after setting defaults (or if they were already set)
         updateTokenButtonUI(elements.swapFromTokenButton, swapState.fromToken);
         updateTokenButtonUI(elements.swapToTokenButton, swapState.toToken);
    }

    /** Calculates the base swap rate (priceFrom / priceTo) without fees. */
    function calculateSwapRate() {
        const { fromToken, toToken } = swapState;
        swapState.rate = 0; // Reset
        swapState.isRateLoading = true;
        updateSwapUI(); // Show loading state in UI

        if (!fromToken || !toToken || !availableTokens[fromToken] || !availableTokens[toToken]) {
            console.warn("Cannot calculate rate: Missing token selection or definition.");
            swapState.isRateLoading = false;
            calculateSwapAmounts(); // Will result in 0 'toAmount', updates UI
            return;
        }

        const fromPrice = availableTokens[fromToken].priceUSD || 0;
        const toPrice = availableTokens[toToken].priceUSD || 0;

        if (fromPrice <= 0 || toPrice <= 0) {
            console.error("Cannot calculate rate: Token price is zero or missing for", fromToken, "or", toToken);
             swapState.isRateLoading = false;
            calculateSwapAmounts(); // Will result in 0 'toAmount', updates UI
            if(elements.swapRateDisplay) {
                 elements.swapRateDisplay.textContent = 'Rate unavailable (price error)';
                 elements.swapRateDisplay.classList.add('error');
            }
            return;
        }

        swapState.rate = fromPrice / toPrice;
        swapState.isRateLoading = false;
        console.log(`Calculated base rate 1 ${fromToken} = ${swapState.rate} ${toToken}`);
        calculateSwapAmounts(); // Calculate final 'to' amount including fees
    }

    /** Calculates the estimated 'to' amount based on 'from' amount, rate, and fee. */
    function calculateSwapAmounts() {
        const { fromToken, toToken, fromAmount, rate } = swapState;
        swapState.toAmount = 0; // Reset

        if (!fromToken || !toToken || !fromAmount || fromAmount <= 0 || rate <= 0) {
            updateSwapUI(); // Update UI even if calculation isn't possible
            return;
        }

        let calculatedToAmount = 0;
        const feeMultiplier = SWAP_FEE_PERCENT / 100;

        // Apply fee based on swap direction
        if (fromToken === 'USD') { // Buying Coin (Fee deducted from input USD)
            const amountAfterFee = fromAmount * (1 - feeMultiplier);
            calculatedToAmount = amountAfterFee * rate;
        } else if (toToken === 'USD') { // Selling Coin (Fee deducted from output USD)
            calculatedToAmount = (fromAmount * rate) * (1 - feeMultiplier);
        } else { // Coin to Coin (Fee deducted from output Coin)
            const baseToAmount = fromAmount * rate;
            calculatedToAmount = baseToAmount * (1 - feeMultiplier);
        }

        swapState.toAmount = calculatedToAmount > 0 ? calculatedToAmount : 0;
        updateSwapUI(); // Update UI with the final calculated 'to' amount
    }

    // Debounced version for input handler
    const debouncedCalculateSwapAmounts = debounce(calculateSwapAmounts, DEBOUNCE_DELAY);

    /** Handles changes in the 'From' amount input field. */
    function handleFromAmountChange() {
        if (!elements.swapFromAmountInput) return;
        swapState.fromAmount = sanitizeFloat(elements.swapFromAmountInput.value);
        // Trigger debounced calculation of the 'to' amount
        debouncedCalculateSwapAmounts();
    }

    /** Switches the 'from' and 'to' tokens in the swap state and UI. */
    function switchSwapTokens() {
        console.log("Switching swap tokens");
        const tempToken = swapState.fromToken;
        swapState.fromToken = swapState.toToken;
        swapState.toToken = tempToken;

        // Attempt to preserve value by setting the new 'from' amount based on the old 'to' amount estimate
        // This provides a smoother UX than just resetting the amount.
        swapState.fromAmount = swapState.toAmount; // Use the *estimated* previous output

        // Clear the old 'to' amount display immediately
        swapState.toAmount = 0;
        if (elements.swapToAmountInput) elements.swapToAmountInput.value = '';


        // Recalculate everything based on the new direction and amount
        calculateSwapRate(); // This will recalculate rate AND call calculateSwapAmounts -> updateSwapUI
    }

    /** Validates swap inputs and enables/disables the swap button. */
    function validateSwapInput() {
        if (!elements.executeSwapButton) return;
        const { fromToken, toToken, fromAmount, toAmount } = swapState;
        const hasSufficientBalance = (userBalances[fromToken] || 0) >= fromAmount;

        const isValid = !!(fromToken && toToken && fromAmount > 0 && toAmount > 0 && hasSufficientBalance);

        elements.executeSwapButton.disabled = !isValid;

        // Provide subtle feedback if balance is insufficient
        if (fromToken && fromAmount > 0 && !hasSufficientBalance) {
             if(elements.swapFromBalance) elements.swapFromBalance.style.color = 'var(--error-color)';
        } else {
             if(elements.swapFromBalance) elements.swapFromBalance.style.color = ''; // Reset color
        }
    }

    /** Updates all UI elements on the swap page based on the current swapState. */
    function updateSwapUI() {
        console.log("Updating Swap UI, State:", swapState);
        // Update token selector buttons
        updateTokenButtonUI(elements.swapFromTokenButton, swapState.fromToken);
        updateTokenButtonUI(elements.swapToTokenButton, swapState.toToken);

        // Update amount inputs (handle potential focus issues carefully if needed)
        if (elements.swapFromAmountInput && document.activeElement !== elements.swapFromAmountInput) {
             elements.swapFromAmountInput.value = swapState.fromAmount > 0 ? swapState.fromAmount : '';
        }
        if (elements.swapToAmountInput) {
            const decimals = swapState.toToken === 'USD' ? 2 : 6;
            elements.swapToAmountInput.value = swapState.toAmount > 0 ? formatTokenAmount(swapState.toAmount, decimals) : '';
        }

        // Update balance displays
        updateSwapBalancesUI();

        // Update rate display
        if (elements.swapRateDisplay) {
            elements.swapRateDisplay.classList.remove('error', 'loading');
            if (swapState.isRateLoading) {
                elements.swapRateDisplay.textContent = 'Calculating rate...';
                 elements.swapRateDisplay.classList.add('loading');
            } else if (swapState.rate > 0 && swapState.fromToken && swapState.toToken) {
                elements.swapRateDisplay.textContent = `1 ${swapState.fromToken} ≈ ${formatTokenAmount(swapState.rate)} ${swapState.toToken}`;
            } else if (swapState.fromToken && swapState.toToken) {
                 elements.swapRateDisplay.textContent = 'Enter amount to swap'; // Or Rate Unavailable if price error occurred
            }
             else {
                elements.swapRateDisplay.textContent = 'Select tokens';
            }
        }

        // Validate inputs to enable/disable swap button
        validateSwapInput();
    }

    /**
     * Executes the swap operation.
     * WARNING: THIS IS AN INSECURE CLIENT-SIDE SIMULATION. NEEDS BACKEND.
     */
    async function executeSwap() {
        if (!userDbRef || !currentUser || !elements.executeSwapButton || elements.executeSwapButton.disabled) {
            console.warn("Swap execution prevented: Missing refs, user, or button disabled.");
            return;
        }

        const { fromToken, toToken, fromAmount, toAmount, rate } = swapState;

        // Final client-side validation before attempting the write
        if (!fromToken || !toToken || fromAmount <= 0 || toAmount <= 0 || (userBalances[fromToken] || 0) < fromAmount) {
            showTgAlert("Swap details are invalid or you have insufficient balance.", "Swap Error");
            validateSwapInput(); // Re-check button state
            return;
        }

        showLoading("Processing Swap...");
        elements.executeSwapButton.disabled = true; // Disable button immediately
        if (elements.swapStatus) { elements.swapStatus.textContent = 'Processing...'; elements.swapStatus.className = 'status-message pending'; }

        // Calculate final balances
        const newFromBalance = (userBalances[fromToken] || 0) - fromAmount;
        const newToBalance = (userBalances[toToken] || 0) + toAmount;

        // ** INSECURE PART: Preparing multi-location update from client **
        // This requires permissive Firebase rules and should ONLY be done by a trusted backend.
        const updates = {};
        const senderId = currentUser.id.toString(); // Ensure string ID
        updates[`/users/${senderId}/balances/${fromToken}`] = sanitizeFloat(newFromBalance.toFixed(PRECISION));
        updates[`/users/${senderId}/balances/${toToken}`] = sanitizeFloat(newToBalance.toFixed(PRECISION));

        // Log the transaction
        const txData = {
            type: 'swap',
            fromToken,
            fromAmount,
            toToken,
            toAmount, // The actual amount received after fees
            baseRate: rate, // Log the rate before fees
            feePercent: SWAP_FEE_PERCENT,
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            status: 'completed' // Status should be updated by backend in reality
        };
        const newTxKey = db.ref(`/transactions/${senderId}`).push().key; // Generate transaction ID
        if (newTxKey) {
             updates[`/transactions/${senderId}/${newTxKey}`] = txData;
        } else {
             console.error("Failed to generate transaction key!");
             // Optionally abort the swap here
        }
        // ** END INSECURE PART **

        try {
            // Attempt the atomic update
            await db.ref().update(updates);
            console.log("Swap successful (Client-side simulation). Updates:", updates);
            if (elements.swapStatus) { elements.swapStatus.textContent = 'Swap Successful!'; elements.swapStatus.className = 'status-message success'; }

            // Reset form after success
            setTimeout(() => {
                swapState.fromAmount = 0;
                swapState.toAmount = 0;
                // Keep tokens selected for potential subsequent swaps
                updateSwapUI();
                if (elements.swapStatus) elements.swapStatus.textContent = ''; // Clear status message
            }, 2500);

        } catch (error) {
            handleFirebaseError(error, "executing swap");
            if (elements.swapStatus) { elements.swapStatus.textContent = 'Swap Failed. Please try again.'; elements.swapStatus.className = 'status-message error'; }
            // Important: If the update fails, the user's local balance might be out of sync
            // until the listener receives the correct data or the app is refreshed.
        } finally {
            hideLoading();
            // Re-enable button based on validation after potential balance update via listener
            validateSwapInput();
        }
    }

    /** Sets up the initial state for the swap page. */
    function setupSwapPage() {
        console.log("Setting up Swap Page");
        // Reset amounts, keep selected tokens (or reset if desired)
        swapState.fromAmount = 0;
        swapState.toAmount = 0;
        // Ensure token selectors are populated if tokens are available
        if (Object.keys(availableTokens).length > 0) {
             populateTokenSelectors();
        }
        calculateSwapRate(); // Calculate initial rate based on selected tokens
        if(elements.swapStatus) elements.swapStatus.textContent = ''; // Clear any previous status
    }


    // --- Internal Send Functionality ---

    /** Populates the asset selector dropdown on the Send page. */
    function updateWithdrawAssetSelector() {
        if (!elements.withdrawAssetSelect) return;
        const previousValue = elements.withdrawAssetSelect.value;
        elements.withdrawAssetSelect.innerHTML = '<option value="">-- Select Asset --</option>'; // Reset

        Object.keys(availableTokens)
            .sort((a, b) => a.localeCompare(b)) // Alphabetical sort
            .forEach(symbol => {
                const tokenInfo = availableTokens[symbol];
                if (tokenInfo) {
                    const option = document.createElement('option');
                    option.value = symbol;
                    option.textContent = `${tokenInfo.name} (${symbol})`;
                    elements.withdrawAssetSelect.appendChild(option);
                }
            });

        // Restore previous selection if still valid
        if (previousValue && elements.withdrawAssetSelect.querySelector(`option[value="${previousValue}"]`)) {
            elements.withdrawAssetSelect.value = previousValue;
        } else {
             elements.withdrawAssetSelect.value = ""; // Default to placeholder
        }
        updateWithdrawPageBalance(); // Update balance display for the selected asset
    }

    /** Updates the 'Available' balance text on the Send page. */
    function updateWithdrawPageBalance() {
        if (!elements.withdrawAvailableBalance || !elements.withdrawAssetSelect) return;
        const selectedSymbol = elements.withdrawAssetSelect.value;
        const balance = userBalances[selectedSymbol] || 0;
        const decimals = selectedSymbol === 'USD' ? 2 : 6;

        elements.withdrawAvailableBalance.textContent = `${formatTokenAmount(balance, decimals)} ${selectedSymbol || ''}`;

        if (elements.withdrawMaxButton) elements.withdrawMaxButton.disabled = balance <= 0;
        validateSendInput(); // Re-validate inputs after balance potentially changes
    }

    /** Validates all inputs on the Send page and updates button/status. */
    function validateSendInput() {
        if (!elements.sendButton || !elements.withdrawAssetSelect || !elements.withdrawAmountInput || !elements.withdrawRecipientIdInput || !elements.withdrawStatus) return;

        const selectedSymbol = elements.withdrawAssetSelect.value;
        const amount = sanitizeFloat(elements.withdrawAmountInput.value);
        const balance = userBalances[selectedSymbol] || 0;
        const recipientIdStr = elements.withdrawRecipientIdInput.value.trim();
        const recipientId = sanitizeInt(recipientIdStr);

        let isValid = true;
        let statusMsg = '';
        elements.withdrawStatus.className = 'status-message'; // Reset style

        if (!selectedSymbol) isValid = false; // Must select asset
        else if (amount <= 0) isValid = false; // Must enter positive amount
        else if (amount > balance) { isValid = false; statusMsg = 'Amount exceeds available balance.'; elements.withdrawStatus.className = 'status-message error'; }
        else if (!recipientIdStr) isValid = false; // Must enter recipient
        else if (!/^\d+$/.test(recipientIdStr) || recipientId <= 0) { isValid = false; statusMsg = 'Invalid Recipient Chat ID (must be numeric).'; elements.withdrawStatus.className = 'status-message error'; }
        else if (currentUser && recipientId === currentUser.id) { isValid = false; statusMsg = 'You cannot send funds to yourself.'; elements.withdrawStatus.className = 'status-message error'; }

        elements.sendButton.disabled = !isValid;
        elements.withdrawStatus.textContent = statusMsg; // Show validation errors
    }

    /**
     * Executes the internal transfer.
     * WARNING: THIS IS AN INSECURE CLIENT-SIDE SIMULATION. NEEDS BACKEND.
     */
    async function handleSend() {
        if (!userDbRef || !currentUser || !db || !elements.sendButton || elements.sendButton.disabled) {
            console.warn("Send execution prevented: Missing refs, user, or button disabled.");
            return;
        }

        const selectedSymbol = elements.withdrawAssetSelect.value;
        const recipientId = sanitizeInt(elements.withdrawRecipientIdInput.value);
        const amount = sanitizeFloat(elements.withdrawAmountInput.value);
        const senderId = currentUser.id;
        const senderBalance = userBalances[selectedSymbol] || 0; // Use current known balance

        // Final client-side validation check
        if (!selectedSymbol || amount <= 0 || !recipientId || recipientId === senderId || senderBalance < amount) {
            showTgAlert("Invalid send details or insufficient funds.", "Send Error");
            validateSendInput(); // Re-run validation to show specific error
            return;
        }

        showLoading("Processing Transfer...");
        elements.sendButton.disabled = true;
        if (elements.withdrawStatus) { elements.withdrawStatus.textContent = 'Verifying recipient...'; elements.withdrawStatus.className = 'status-message pending'; }

        // ** INSECURE PART 1: Client-side Recipient Check **
        // This should be done securely on a backend.
        const recipientRef = db.ref(`users/${recipientId}`);
        let recipientExists = false;
        try {
            // A simple check if the user node exists (could be more robust by checking a specific profile field)
            const recipientSnapshot = await recipientRef.child('profile').once('value');
            recipientExists = recipientSnapshot.exists();
            if (recipientExists) console.log(`Recipient ${recipientId} found.`);
            else console.warn(`Recipient ${recipientId} check: Not found.`);
        } catch (error) {
            console.error("Error checking recipient existence:", error);
            // Decide how to proceed - fail safe or attempt transfer anyway?
            // For demo, we'll fail if check explicitly fails or doesn't find user.
            handleFirebaseError(error, "checking recipient");
            if (elements.withdrawStatus) { elements.withdrawStatus.textContent = 'Error verifying recipient.'; elements.withdrawStatus.className = 'status-message error'; }
            validateSendInput(); // Re-enable button potentially
            return; // Stop execution
        }

        if (!recipientExists) {
            hideLoading();
            if (elements.withdrawStatus) { elements.withdrawStatus.textContent = 'Recipient Chat ID not found in AB Wallet.'; elements.withdrawStatus.className = 'status-message error'; }
            validateSendInput(); // Re-enable button potentially
            return;
        }
        // ** END INSECURE CHECK **

        if (elements.withdrawStatus) elements.withdrawStatus.textContent = 'Processing transfer...'; // Update status

        // ** INSECURE PART 2: Simulating Atomic Update Client-Side **
        // This requires a backend using Firebase Transactions or Admin SDK for safety.
        const updates = {};
        const senderBalancePath = `/users/${senderId}/balances/${selectedSymbol}`;
        const recipientBalancePath = `/users/${recipientId}/balances/${selectedSymbol}`;

        // Attempt to read recipient balance just before writing (still prone to race conditions client-side)
        let recipientCurrentBalance = 0;
        try {
            const recipBalanceSnapshot = await recipientRef.child(`balances/${selectedSymbol}`).once('value');
            recipientCurrentBalance = sanitizeFloat(recipBalanceSnapshot.val());
            console.log(`Recipient ${recipientId} current ${selectedSymbol} balance: ${recipientCurrentBalance}`);
        } catch (e) {
            console.warn("Could not read recipient balance accurately before update:", e);
            // Proceeding, but the recipient's final balance might be incorrect if there were concurrent writes.
        }

        const newSenderBalance = senderBalance - amount;
        const newRecipientBalance = recipientCurrentBalance + amount;

        // Prepare updates with precision
        updates[senderBalancePath] = sanitizeFloat(newSenderBalance.toFixed(PRECISION));
        updates[recipientBalancePath] = sanitizeFloat(newRecipientBalance.toFixed(PRECISION));

        // Log transaction for both sender and receiver
        const txId = db.ref(`/transactions/${senderId}`).push().key; // Generate unique TX ID
        const timestamp = firebase.database.ServerValue.TIMESTAMP;
        if (txId) {
            const senderTx = { type: 'send', token: selectedSymbol, amount, recipientId, timestamp, status: 'completed' };
            const receiverTx = { type: 'receive', token: selectedSymbol, amount, senderId, timestamp, status: 'completed' };
            updates[`/transactions/${senderId}/${txId}`] = senderTx;
            updates[`/transactions/${recipientId}/${txId}`] = receiverTx;
        } else {
             console.error("Fatal: Could not generate transaction ID. Aborting transfer.");
             showTgAlert("Could not process transfer due to internal error.", "Transfer Failed");
             hideLoading();
             validateSendInput();
             return;
        }
        // ** END INSECURE UPDATE PREPARATION **

        try {
            // Attempt the multi-location update
            await db.ref().update(updates);
            console.log("Internal transfer successful (Client-side simulation). Updates:", updates);
            if (elements.withdrawStatus) { elements.withdrawStatus.textContent = 'Funds Sent Successfully!'; elements.withdrawStatus.className = 'status-message success'; }

            // Clear inputs on success
            if(elements.withdrawAmountInput) elements.withdrawAmountInput.value = '';
            if(elements.withdrawRecipientIdInput) elements.withdrawRecipientIdInput.value = '';
            // Clear status after a delay
            setTimeout(() => { if (elements.withdrawStatus) elements.withdrawStatus.textContent = ''; }, 3000);

        } catch (error) {
            handleFirebaseError(error, "executing internal transfer");
            if (elements.withdrawStatus) { elements.withdrawStatus.textContent = 'Send Failed. Please try again.'; elements.withdrawStatus.className = 'status-message error'; }
            // Note: If the update fails, balances might be inconsistent.
        } finally {
            hideLoading();
            // Let the balance listener update UI and re-validate the button state
            // validateSendInput(); // Called indirectly by listener update
        }
    }

    /** Sets up the initial state for the Send page. */
    function setupSendPage() {
        console.log("Setting up Send Page");
        if(elements.withdrawAssetSelect) updateWithdrawAssetSelector(); // Ensure asset list is current
        if(elements.withdrawAmountInput) elements.withdrawAmountInput.value = '';
        if(elements.withdrawRecipientIdInput) elements.withdrawRecipientIdInput.value = '';
        if(elements.withdrawStatus) { elements.withdrawStatus.textContent = ''; elements.withdrawStatus.className = 'status-message'; }
        updateWithdrawPageBalance(); // Update balance display based on potentially pre-selected asset
        validateSendInput(); // Set initial button state
    }


    // --- Event Listeners Setup ---
    function setupEventListeners() {
        console.log("Setting up event listeners...");

        // Navigation
        elements.navButtons.forEach(button => {
            button.addEventListener('click', () => {
                // Prevent re-navigating to the same page
                if (!button.classList.contains('active')) {
                    showPage(button.dataset.page);
                }
            });
        });
        elements.backButtons.forEach(button => {
            button.addEventListener('click', () => showPage(button.dataset.target || 'home-page'));
        });
        if (elements.refreshButton) {
            elements.refreshButton.addEventListener('click', async () => {
                showLoading("Refreshing data...");
                try {
                    await fetchAvailableTokens(); // Re-fetch token prices/definitions
                    // Re-fetch user data is implicitly handled by re-initializing or could be forced
                    // For simplicity, let's rely on the listener or trigger a full re-init if needed
                    // await initializeFirebaseAndUser(); // More forceful refresh
                    updateHomePageUI(); // Update current view
                } catch (error) {
                    console.error("Refresh failed:", error);
                } finally {
                    hideLoading();
                }
            });
        }

        // Swap Page
        if (elements.swapFromAmountInput) elements.swapFromAmountInput.addEventListener('input', handleFromAmountChange);
        if (elements.swapSwitchButton) elements.swapSwitchButton.addEventListener('click', switchSwapTokens);
        if (elements.executeSwapButton) elements.executeSwapButton.addEventListener('click', executeSwap);
        if (elements.swapFromTokenButton) elements.swapFromTokenButton.addEventListener('click', () => openTokenModal('from'));
        if (elements.swapToTokenButton) elements.swapToTokenButton.addEventListener('click', () => openTokenModal('to'));

        // Token Modal
        if (elements.closeModalButton) elements.closeModalButton.addEventListener('click', closeTokenModal);
        if (elements.tokenSearchInput) elements.tokenSearchInput.addEventListener('input', debounce((e) => populateTokenListModal(e.target.value), 250)); // Debounced search
        if (elements.tokenModal) elements.tokenModal.addEventListener('click', (e) => { if (e.target === elements.tokenModal) closeTokenModal(); }); // Close on backdrop click

        // Send Page
        if (elements.withdrawAssetSelect) elements.withdrawAssetSelect.addEventListener('change', updateWithdrawPageBalance);
        if (elements.withdrawAmountInput) elements.withdrawAmountInput.addEventListener('input', debounce(validateSendInput, DEBOUNCE_DELAY)); // Debounce validation
        if (elements.withdrawRecipientIdInput) elements.withdrawRecipientIdInput.addEventListener('input', debounce(validateSendInput, DEBOUNCE_DELAY)); // Debounce validation
        if (elements.withdrawMaxButton) {
            elements.withdrawMaxButton.addEventListener('click', () => {
                const selectedSymbol = elements.withdrawAssetSelect?.value;
                if (selectedSymbol && elements.withdrawAmountInput) {
                    const balance = userBalances[selectedSymbol] || 0;
                    // Set slightly less than total if needed for fees in a real app, or full balance here
                    elements.withdrawAmountInput.value = balance > 0 ? balance : '';
                    validateSendInput(); // Trigger immediate validation
                }
            });
        }
        if (elements.sendButton) elements.sendButton.addEventListener('click', handleSend);

        console.log("Event listeners attached.");
    }

    // --- App Initialization ---
    /** Main function to start the wallet application. */
    async function startApp() {
        console.log("Starting AB Wallet Application...");
        showLoading("Initializing...");

        // Setup Telegram WebApp environment
        tg.ready();
        tg.expand();
        tg.enableClosingConfirmation(); // Warn user before closing the WebApp

        // Apply theme variables from Telegram if needed (though CSS sets dark theme)
        document.body.style.setProperty('--tg-theme-bg-color', tg.themeParams.bg_color || '#1a1a1a');
        document.body.style.setProperty('--tg-theme-text-color', tg.themeParams.text_color || '#e0e0e0');
        // ... map other themeParams to CSS variables if desired ...

        // Attach event listeners once the DOM is ready
        setupEventListeners();

        // Get user data (use unsafe for display, VALIDATE initData on backend for security)
        if (tg.initDataUnsafe?.user) {
            currentUser = tg.initDataUnsafe.user;
            console.log("User Data obtained:", currentUser.id);
            displayUserInfo(); // Display basic info while data loads

            try {
                 // Initialize Firebase App
                 if (!firebase.apps.length) { firebaseApp = firebase.initializeApp(firebaseConfig); }
                 else { firebaseApp = firebase.app(); }
                 db = firebase.database();
                 console.log("Firebase Initialized");

                 // Fetch tokens definitions
                 await fetchAvailableTokens();

                 // Load user data / create user / attach listener
                 await initializeFirebaseAndUser();

                 // Show the default page after successful initialization
                 showPage('home-page');

            } catch (error) {
                 console.error("Critical Initialization Error:", error);
                 handleFirebaseError(error, "App Initialization");
                 showLoading("Error Loading Wallet"); // Show error on loading screen
                 disableAppFeatures();
                 // Optionally show a persistent error message in the main area
                 if(elements.mainContent) elements.mainContent.innerHTML = `<p class="status-message error card">Failed to initialize AB Wallet. Please try again later.</p>`;
            }

        } else {
            console.error("Critical: Could not retrieve Telegram user data.");
            showTgAlert("Cannot load user data. Wallet is unavailable.", "Fatal Error");
            showLoading("User Data Error");
            disableAppFeatures();
              if(elements.mainContent) elements.mainContent.innerHTML = `<p class="status-message error card">Could not load user data from Telegram. Please ensure you are running this inside Telegram.</p>`;
        }
        // Hide loading only if initialization didn't fail critically before this point
        // hideLoading(); // Moved inside initializeFirebaseAndUser success path
    }

    // Start the application logic after the DOM is fully loaded
    startApp();

}); // End DOMContentLoaded
