// @ts-check // Enables type checking in VS Code, optional but helpful

/**
 * AB Wallet - firebase.js
 *
 * Handles Firebase interaction, application logic, and UI updates for the
 * AB Wallet Telegram Web App.
 *
 * WARNING: This is a client-side implementation for demonstration purposes ONLY.
 * It performs financial operations directly from the client, which is INSECURE.
 * A secure backend is REQUIRED for a production application handling real value.
 */

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
    /** @type {any | null} Current Telegram User object (Replace 'any' with a proper type if available) */
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
    let transactionListenerDetacher = null; // Kept for potential future use

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
    // Cache frequently accessed elements for performance and clarity
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

    /** Formats a number as USD currency string (e.g., "$1,234.56"). */
    const formatCurrency = (amount) => {
        const num = sanitizeFloat(amount);
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
    };

    /** Formats a token amount with dynamic decimal places for display. */
    const formatTokenAmount = (amount, decimals = 6) => {
         const num = sanitizeFloat(amount);
         // Show more decimals for very small non-zero amounts, fewer for very large amounts
         const effectiveDecimals = num !== 0 && Math.abs(num) < 0.01 ? Math.max(decimals, 4) : (Math.abs(num) > 10000 ? 2 : decimals);
         return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: effectiveDecimals });
    };

    /** Parses a value to a float, defaulting to 0. */
    const sanitizeFloat = (value) => parseFloat(String(value)) || 0;

    /** Parses a value to an integer, defaulting to 0. */
    const sanitizeInt = (value) => parseInt(String(value), 10) || 0;

    /** Debounce utility to limit rapid function execution. */
    const debounce = (func, delay) => {
        let timeoutId;
        /** @param {...any} args */
        return function(...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                func.apply(this, args);
            }, delay);
        };
    };

    /** Formats a Firebase timestamp into a relative string ("Just now", "5m ago") or short date. */
    const formatTimestamp = (timestamp) => {
        if (!timestamp || typeof timestamp !== 'number') return 'Unknown date';
        const now = Date.now();
        const date = new Date(timestamp);
        const diffSeconds = Math.round((now - date.getTime()) / 1000);

        if (diffSeconds < 5) return 'Just now';
        if (diffSeconds < 60) return `${diffSeconds}s ago`;
        if (diffSeconds < 3600) return `${Math.round(diffSeconds / 60)}m ago`;
        if (diffSeconds < 86400) return `${Math.round(diffSeconds / 3600)}h ago`;
        if (diffSeconds < 604800) return `${Math.round(diffSeconds / 86400)}d ago`;

        const options = /** @type {Intl.DateTimeFormatOptions} */ ({ month: 'short', day: 'numeric' });
        if (date.getFullYear() !== new Date().getFullYear()) {
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

    /** Displays an alert using Telegram's UI or fallback. */
    function showTgAlert(message, title = 'Alert') {
        const fullMessage = `${title}: ${message}`;
        if (tg?.showAlert) { tg.showAlert(fullMessage); }
        else { alert(fullMessage); console.warn("Fallback alert used."); }
    }

    /** Centralized Firebase error handler. */
    function handleFirebaseError(error, context = "Firebase Operation") {
        console.error(`${context} Error:`, error); // Log detailed error
        hideLoading();
        let userMessage = `Operation failed. ${error.message || 'Please try again.'}`;
        // Provide more user-friendly messages for common errors
        if (error.code === 'PERMISSION_DENIED') {
            userMessage = "Action not allowed. Please check permissions or contact support.";
        } else if (error.code === 'NETWORK_ERROR' || error.message?.includes('network error')) {
            userMessage = "Network connection issue. Please check your internet and try again.";
        } else if (error.code === 'UNAVAILABLE') {
             userMessage = "Service temporarily unavailable. Please try again later.";
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

        if (!pageFound) {
            console.warn(`Page "${pageId}" not found, defaulting to home.`);
            pageId = 'home-page';
            elements.pages[0]?.classList.add('active');
        }

        elements.navButtons.forEach(button => {
            button.classList.toggle('active', button.dataset.page === pageId);
        });
        if (elements.mainContent) elements.mainContent.scrollTop = 0;

        // Trigger page-specific setup/data loading
        switch (pageId) {
            case 'home-page': updateHomePageUI(); fetchAndDisplayTransactions(); break;
            case 'swap-page': setupSwapPage(); break;
            case 'deposit-page': setupReceivePage(); break;
            case 'withdraw-page': setupSendPage(); break;
        }
    }


    // --- Core Data Handling & UI Updates ---

    /** Fetches token definitions from Firebase `/tokens`. */
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
            availableTokens = {}; // Reset on error to prevent issues
            throw error; // Re-throw to potentially stop initialization if critical
        }
    }

    /** Updates the Home page portfolio and total balance display. */
    function updateHomePageUI() {
        if (!elements.assetListContainer || !elements.totalBalanceDisplay) return;
        console.log("Updating Home Portfolio UI");

        let totalValueUSD = 0;
        elements.assetListContainer.innerHTML = ''; // Clear previous list

        const heldSymbols = Object.keys(userBalances)
            .filter(symbol => userBalances[symbol] > 0.0000001 && availableTokens[symbol]) // Check balance and token definition
            .sort((a, b) => { // Sort by USD value descending
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
        // Update total balance display (just the number)
        elements.totalBalanceDisplay.textContent = totalValueUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    /** Displays the current user's basic Telegram info. */
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

    /** Sets up the Receive page UI. */
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

    /** Fetches and displays recent transactions for the current user. */
    async function fetchAndDisplayTransactions(limit = RECENT_TRANSACTIONS_LIMIT) {
        if (!userTransactionsRef) { console.warn("Transaction ref not available."); return; }
        if (!elements.transactionListContainer) return;

        console.log(`Fetching last ${limit} transactions...`);
        elements.transactionListContainer.innerHTML = '<p class="placeholder-text">Loading transactions...</p>'; // Show loading state

        try {
            // Query Firebase for the last 'limit' transactions ordered by timestamp
            const snapshot = await userTransactionsRef.orderByChild('timestamp').limitToLast(limit).once('value');
            const transactionsData = snapshot.val();

            if (!transactionsData || Object.keys(transactionsData).length === 0) {
                elements.transactionListContainer.innerHTML = '<p class="no-transactions placeholder-text">No recent transactions.</p>';
                return;
            }
            elements.transactionListContainer.innerHTML = ''; // Clear loading/placeholder

            // Convert Firebase object to array and sort descending (most recent first)
            const sortedTx = Object.entries(transactionsData)
                                .map(([id, data]) => ({ id, ...data }))
                                .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

            // Render each transaction
            sortedTx.forEach(tx => {
                const txElement = createTransactionElement(tx);
                elements.transactionListContainer.appendChild(txElement);
            });

        } catch (error) {
            handleFirebaseError(error, "fetching transactions");
            elements.transactionListContainer.innerHTML = '<p class="no-transactions placeholder-text error">Could not load transactions.</p>';
        }
    }

    /** Creates and returns an HTML element representing a single transaction. */
    function createTransactionElement(tx) {
        const div = document.createElement('div');
        div.className = 'transaction-item';
        div.dataset.txId = tx.id; // Store the full Firebase key

        let iconClass = '', iconName = 'receipt_long'; // Default icon
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
                // Combine amounts for swap display
                amountText = `-${formatAmt(tx.fromAmount, tx.fromToken)} / +${formatAmt(tx.toAmount, tx.toToken)}`;
                counterpartyText = `Rate ≈ ${formatTokenAmount(tx.baseRate, 6)}`; // Show approximate base rate
                break;
            default:
                infoText = `Tx: ${tx.type || 'Unknown'}`;
                amountText = `${formatAmt(tx.amount || 0, tx.token)} ${tx.token || ''}`;
                break;
        }

        // Use last 6 chars of Firebase push ID for display
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
                 <span>${formatTimestamp(tx.timestamp)}</span>
                 <span class="tx-id">${shortTxId}</span>
            </div>
        `;
        return div;
    }


    // --- Firebase Realtime Listeners ---

    /** Sets up the listener for realtime balance updates on `/users/{userId}/balances`. */
    function setupBalanceListener() {
        if (!userDbRef) { console.error("Cannot setup balance listener: userDbRef is null."); return; }
        if (balanceListenerAttached) { console.log("Balance listener already running."); return; }

        console.log("Setting up Firebase balance listener...");
        const balancesRef = userDbRef.child('balances');

        balancesRef.on('value', (snapshot) => {
            userBalances = snapshot.val() || {}; // Update global state
            console.log("Realtime balance update received:", userBalances);

            // Determine active page and update relevant UI sections
            const activePageId = document.querySelector('.page.active')?.id;
            if (activePageId) {
                switch (activePageId) {
                    case 'home-page': updateHomePageUI(); break;
                    case 'swap-page': updateSwapBalancesUI(); validateSwapInput(); break;
                    case 'withdraw-page': updateWithdrawPageBalance(); break; // This calls validateSendInput
                }
            }
        }, (error) => {
            handleFirebaseError(error, "listening to balance changes");
            balanceListenerAttached = false; // Allow re-attachment attempt
        });
        balanceListenerAttached = true;
        console.log("Firebase balance listener attached.");
    }

    /** (Optional) Sets up a listener for new transactions. Needs careful UI management. */
    function setupTransactionListener() {
        if (!userTransactionsRef) { console.error("Cannot setup transaction listener: userTransactionsRef is null."); return; }
        if (transactionListenerDetacher) { console.log("Transaction listener already active."); return; }
        console.log("Setting up live transaction listener...");

        // Detach previous listener if any (shouldn't happen with flag, but safe)
        if (transactionListenerDetacher) transactionListenerDetacher();

        const query = userTransactionsRef.orderByChild('timestamp').limitToLast(1); // Listen for the newest one

        const listenerCallback = (snapshot) => {
            if (!snapshot?.key || !snapshot.val()) return;
            const txId = snapshot.key;
            const txData = snapshot.val();
            console.log("New transaction detected via listener:", txId);

            // Check if transaction already rendered to avoid duplicates from initial fetch vs. listener
            if (elements.transactionListContainer?.querySelector(`[data-tx-id="${txId}"]`)) {
                console.log("Transaction already displayed, skipping live update for:", txId);
                return;
            }

            // Only update UI if Home page is active
            if (elements.transactionListContainer && document.getElementById('home-page')?.classList.contains('active')) {
                console.log("Prepending new transaction to list:", txId);
                const txElement = createTransactionElement({ id: txId, ...txData });
                const placeholder = elements.transactionListContainer.querySelector('.no-transactions, .placeholder-text');
                if (placeholder) placeholder.remove(); // Remove "no transactions" message

                elements.transactionListContainer.prepend(txElement); // Add to top

                // Optional: Prune older transactions if list exceeds limit + buffer
                while (elements.transactionListContainer.children.length > RECENT_TRANSACTIONS_LIMIT + 3) {
                    elements.transactionListContainer.lastChild?.remove();
                }
            }
        };

        const errorCallback = (error) => {
            handleFirebaseError(error, "listening for new transactions");
            if (transactionListenerDetacher) { transactionListenerDetacher(); transactionListenerDetacher = null; } // Detach on error
        };

        query.on('child_added', listenerCallback, errorCallback);

        // Store the function to detach the listener later
        transactionListenerDetacher = () => {
             console.log("Detaching live transaction listener.");
             query.off('child_added', listenerCallback);
             transactionListenerDetacher = null; // Clear detacher function
        };
        console.log("Live transaction listener attached.");
    }

    // --- Firebase Initialization and User Setup ---

    /** Initializes Firebase connection, loads static data, loads/creates user data, sets listeners. */
    async function initializeFirebaseAndUser() {
        if (!currentUser?.id) { throw new Error("Cannot initialize Firebase data: User not identified."); }
        if (!db) { throw new Error("Cannot initialize Firebase data: DB not initialized."); }

        console.log(`Initializing data for user: ${currentUser.id}`);
        const userId = currentUser.id.toString();
        userDbRef = db.ref('users/' + userId);
        userTransactionsRef = db.ref('transactions/' + userId); // Set transaction path reference

        try {
            // Fetch/Create user profile and balances
            const snapshot = await userDbRef.once('value');
            if (!snapshot.exists()) {
                console.log(`User ${userId} not found. Creating...`);
                const initialBalances = { USD: 0 }; // Default starting balance
                const newUserProfile = {
                    telegram_id: currentUser.id,
                    first_name: currentUser.first_name || null,
                    last_name: currentUser.last_name || null,
                    username: currentUser.username || null,
                    createdAt: firebase.database.ServerValue.TIMESTAMP,
                    lastLogin: firebase.database.ServerValue.TIMESTAMP
                };
                // Use setWithPriority or just set if no priority needed
                await userDbRef.set({ profile: newUserProfile, balances: initialBalances });
                userBalances = initialBalances;
                console.log("New user created successfully.");
            } else {
                console.log(`User ${userId} found.`);
                const userData = snapshot.val();
                userBalances = userData.balances || { USD: 0 }; // Load balances or default
                // Update non-critical profile info (like last login) silently
                userDbRef.child('profile').update({
                    // Keep existing names if current ones are null/undefined
                    first_name: currentUser.first_name || userData.profile?.first_name || null,
                    last_name: currentUser.last_name || userData.profile?.last_name || null,
                    username: currentUser.username || userData.profile?.username || null,
                    lastLogin: firebase.database.ServerValue.TIMESTAMP
                }).catch(err => console.warn("Non-critical error updating profile info:", err));
            }

            // Attach the realtime balance listener AFTER initial data is set/loaded
            setupBalanceListener();

            // Optional: Attach the live transaction listener
            // setupTransactionListener();

        } catch (error) {
            handleFirebaseError(error, "loading/creating user data");
            throw error; // Re-throw to indicate initialization failure
        }
    }

    /** Disables core interactive elements if initialization fails. */
    function disableAppFeatures() {
        console.error("Disabling core app features due to critical error.");
        elements.navButtons.forEach(b => b.disabled = true);
        elements.backButtons.forEach(b => b.disabled = true);
        if(elements.refreshButton) elements.refreshButton.disabled = true;
        if(elements.sendButton) elements.sendButton.disabled = true;
        if(elements.executeSwapButton) elements.executeSwapButton.disabled = true;
        // Disable form inputs etc. if necessary
    }


    // --- Swap Functionality (Client-Side Simulation) ---

    /** Opens the token selection modal. */
    function openTokenModal(selectorType) {
        if (!elements.tokenModal) return;
        activeTokenSelector = selectorType;
        populateTokenListModal(); // Refresh list based on current availability
        if(elements.tokenSearchInput) elements.tokenSearchInput.value = ''; // Clear search
        elements.tokenModal.style.display = 'flex';
        if(elements.tokenSearchInput) elements.tokenSearchInput.focus();
    }

    /** Closes the token selection modal. */
    function closeTokenModal() {
        if (elements.tokenModal) elements.tokenModal.style.display = 'none';
        activeTokenSelector = null;
    }

    /** Populates the token list in the modal, optionally filtering by search term. */
    function populateTokenListModal(searchTerm = '') {
        if (!elements.tokenListModal) return;
        elements.tokenListModal.innerHTML = ''; // Clear
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
            .sort((a, b) => a.name.localeCompare(b.name))
            .forEach(token => { /* ... create and append list item ... */ });
    }

    /** Handles selection of a token from the modal. */
    function handleTokenSelection(selectedSymbol) {
        if (!activeTokenSelector || !selectedSymbol) return;
        // Auto-swap if selecting the same token as the other side
        if (activeTokenSelector === 'from' && selectedSymbol === swapState.toToken) { switchSwapTokens(); }
        else if (activeTokenSelector === 'to' && selectedSymbol === swapState.fromToken) { switchSwapTokens(); }
        else { swapState[activeTokenSelector === 'from' ? 'fromToken' : 'toToken'] = selectedSymbol; }
        closeTokenModal();
        calculateSwapRate(); // Recalculate after selection changes
    }

    /** Updates the UI (image, symbol) of a token selector button. */
    function updateTokenButtonUI(buttonElement, tokenSymbol) { /* ... */ }
    /** Updates the 'Balance:' text displays below swap inputs. */
    function updateSwapBalancesUI() { /* ... */ }
    /** Sets default 'from'/'to' tokens if needed. */
    function populateTokenSelectors() { /* ... */ }
    /** Calculates the base swap rate from token prices. */
    function calculateSwapRate() { /* ... (sets swapState.rate, calls calculateSwapAmounts) ... */ }
    /** Calculates the final 'to' amount including the fee. */
    function calculateSwapAmounts() { /* ... (applies fee logic, sets swapState.toAmount, calls updateSwapUI) ... */ }
    /** Debounced wrapper for calculateSwapAmounts. */
    const debouncedCalculateSwapAmounts = debounce(calculateSwapAmounts, DEBOUNCE_DELAY);
    /** Handles input changes in the 'from' amount field. */
    function handleFromAmountChange() { /* ... (updates swapState.fromAmount, calls debouncedCalculateSwapAmounts) ... */ }
    /** Switches 'from' and 'to' tokens and attempts to preserve value. */
    function switchSwapTokens() { /* ... (updates swapState, calls calculateSwapRate) ... */ }
    /** Validates all swap inputs and enables/disables the swap button. */
    function validateSwapInput() { /* ... (checks tokens, amounts, balance, sets executeSwapButton.disabled) ... */ }
    /** Updates all UI elements on the swap page based on current swapState. */
    function updateSwapUI() { /* ... (updates inputs, balances, rate display, calls validateSwapInput) ... */ }
    /** Executes the swap (INSECURE CLIENT-SIDE SIMULATION). */
    async function executeSwap() {
        // WARNING: INSECURE - NEEDS BACKEND IMPLEMENTATION
        if (!userDbRef || !currentUser || !elements.executeSwapButton || elements.executeSwapButton.disabled) return;
        const { fromToken, toToken, fromAmount, toAmount, rate } = swapState;
        if (!fromToken || !toToken || fromAmount <= 0 || toAmount <= 0 || (userBalances[fromToken] || 0) < fromAmount) { showTgAlert("Invalid swap or insufficient balance.", "Swap Error"); return; }

        showLoading("Processing Swap...");
        elements.executeSwapButton.disabled = true;
        if (elements.swapStatus) { elements.swapStatus.textContent = 'Processing...'; elements.swapStatus.className = 'status-message pending'; }

        const newFromBalance = (userBalances[fromToken] || 0) - fromAmount;
        const newToBalance = (userBalances[toToken] || 0) + toAmount;

        const updates = {};
        const userId = currentUser.id.toString();
        updates[`/users/${userId}/balances/${fromToken}`] = sanitizeFloat(newFromBalance.toFixed(PRECISION));
        updates[`/users/${userId}/balances/${toToken}`] = sanitizeFloat(newToBalance.toFixed(PRECISION));

        const txData = { type: 'swap', fromToken, fromAmount, toToken, toAmount, baseRate: rate, feePercent: SWAP_FEE_PERCENT, timestamp: firebase.database.ServerValue.TIMESTAMP, status: 'completed' };
        const newTxKey = db?.ref(`/transactions/${userId}`).push().key; // Use optional chaining for db
        if (db && newTxKey) { updates[`/transactions/${userId}/${newTxKey}`] = txData; } else { console.error("DB or newTxKey unavailable for swap log!"); }

        try {
            if(db) await db.ref().update(updates); // Use optional chaining
            else throw new Error("Database not available for swap update.");

            console.log("Swap successful (simulated).");
            if (elements.swapStatus) { elements.swapStatus.textContent = 'Swap Successful!'; elements.swapStatus.className = 'status-message success'; }
            setTimeout(() => { swapState.fromAmount = 0; swapState.toAmount = 0; updateSwapUI(); if (elements.swapStatus) elements.swapStatus.textContent = ''; }, 2500);
        } catch (error) { handleFirebaseError(error, "executing swap"); if (elements.swapStatus) { elements.swapStatus.textContent = 'Swap Failed.'; elements.swapStatus.className = 'status-message error'; }
        } finally { hideLoading(); validateSwapInput(); } // Re-validate button state after operation
    }
    /** Prepares the swap page UI. */
    function setupSwapPage() { /* ... (resets amounts, updates UI) ... */ }


    // --- Internal Send Functionality (Client-Side Simulation) ---

    /** Populates the asset selector on the Send page. */
    function updateWithdrawAssetSelector() { /* ... */ }
    /** Updates the 'Available' balance display on the Send page. */
    function updateWithdrawPageBalance() { /* ... */ }
    /** Validates inputs on the Send page. */
    function validateSendInput() { /* ... (checks asset, amount, recipient, balance, sets sendButton.disabled/status) ... */ }
    /** Executes the internal transfer (INSECURE CLIENT-SIDE SIMULATION). */
    async function handleSend() {
        // WARNING: INSECURE - NEEDS BACKEND IMPLEMENTATION
        if (!userDbRef || !currentUser || !db || !elements.sendButton || elements.sendButton.disabled) return;

        const selectedSymbol = elements.withdrawAssetSelect?.value;
        const recipientId = sanitizeInt(elements.withdrawRecipientIdInput?.value);
        const amount = sanitizeFloat(elements.withdrawAmountInput?.value);
        const senderId = currentUser.id;
        const senderBalance = userBalances[selectedSymbol] || 0;

        // Final client validation
        if (!selectedSymbol || amount <= 0 || !recipientId || recipientId === senderId || senderBalance < amount) {
             showTgAlert("Invalid send details or insufficient funds.", "Send Error"); validateSendInput(); return;
        }

        showLoading("Processing Transfer...");
        elements.sendButton.disabled = true;
        if (elements.withdrawStatus) { elements.withdrawStatus.textContent = 'Verifying recipient...'; elements.withdrawStatus.className = 'status-message pending'; }

        // --- INSECURE CLIENT-SIDE RECIPIENT CHECK ---
        const recipientRef = db.ref(`users/${recipientId}`);
        let recipientExists = false;
        try {
            const recipientSnapshot = await recipientRef.child('profile').once('value');
            recipientExists = recipientSnapshot.exists();
        } catch (error) { console.error("Error checking recipient:", error); /* Handle */ }

        if (!recipientExists) {
            hideLoading();
            if (elements.withdrawStatus) { elements.withdrawStatus.textContent = 'Recipient Chat ID not found.'; elements.withdrawStatus.className = 'status-message error'; }
            validateSendInput(); // Re-validate (might re-enable button)
            return;
        }
        // --- END INSECURE CHECK ---

        if (elements.withdrawStatus) elements.withdrawStatus.textContent = 'Processing transfer...';

        // --- INSECURE CLIENT-SIDE ATOMIC UPDATE SIMULATION ---
        const updates = {};
        const senderBalancePath = `/users/${senderId}/balances/${selectedSymbol}`;
        const recipientBalancePath = `/users/${recipientId}/balances/${selectedSymbol}`;
        let recipientCurrentBalance = 0;
        try { // Attempt to get recipient balance just before write (still risky)
            const recipBalanceSnapshot = await recipientRef.child(`balances/${selectedSymbol}`).once('value');
            recipientCurrentBalance = sanitizeFloat(recipBalanceSnapshot.val());
        } catch (e) { console.warn("Could not reliably read recipient balance before update", e); }

        const newSenderBalance = senderBalance - amount;
        const newRecipientBalance = recipientCurrentBalance + amount;

        updates[senderBalancePath] = sanitizeFloat(newSenderBalance.toFixed(PRECISION));
        updates[recipientBalancePath] = sanitizeFloat(newRecipientBalance.toFixed(PRECISION));

        // Log transaction for both parties
        const txId = db.ref(`/transactions/${senderId}`).push().key;
        const timestamp = firebase.database.ServerValue.TIMESTAMP;
        if (txId) {
            const senderTx = { type: 'send', token: selectedSymbol, amount, recipientId, timestamp, status: 'completed' };
            const receiverTx = { type: 'receive', token: selectedSymbol, amount, senderId, timestamp, status: 'completed' };
            updates[`/transactions/${senderId}/${txId}`] = senderTx;
            updates[`/transactions/${recipientId}/${txId}`] = receiverTx;
        } else { console.error("Failed to generate TX ID!"); /* Handle error */ }
        // --- END INSECURE UPDATE ---

        try {
            await db.ref().update(updates);
            console.log("Internal transfer successful (simulated).");
            if (elements.withdrawStatus) { elements.withdrawStatus.textContent = 'Funds Sent Successfully!'; elements.withdrawStatus.className = 'status-message success'; }
            if(elements.withdrawAmountInput) elements.withdrawAmountInput.value = '';
            if(elements.withdrawRecipientIdInput) elements.withdrawRecipientIdInput.value = '';
            setTimeout(() => { if (elements.withdrawStatus) elements.withdrawStatus.textContent = ''; }, 3000);
        } catch (error) { handleFirebaseError(error, "executing internal transfer"); if (elements.withdrawStatus) { elements.withdrawStatus.textContent = 'Send Failed.'; elements.withdrawStatus.className = 'status-message error'; }
        } finally { hideLoading(); validateSendInput(); } // Re-validate button state
    }

    /** Prepares the Send page UI. */
    function setupSendPage() { /* ... (Clears inputs, updates selector/balance, validates) ... */ }


    // --- Event Listeners Setup ---
    /** Attaches all necessary event listeners for the application. */
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
        if (elements.withdrawMaxButton) elements.withdrawMaxButton.addEventListener('click', () => { /* ... Max logic ... */ });
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

            // Apply theme (use CSS default dark theme as base)
            document.body.style.backgroundColor = tg.themeParams.bg_color || '#16181a';
            document.body.style.color = tg.themeParams.text_color || '#e8e8e8';

            // Attach event listeners
            setupEventListeners();

            // Get Telegram User Data
            if (tg.initDataUnsafe?.user) {
                currentUser = tg.initDataUnsafe.user;
                console.log(`User Identified: ${currentUser.id}`);
                displayUserInfo();

                // Initialize Firebase App & DB
                if (!firebase.apps.length) { firebaseApp = firebase.initializeApp(firebaseConfig); }
                else { firebaseApp = firebase.app(); }
                db = firebase.database();
                console.log("Firebase Initialized.");

                // Fetch Tokens FIRST (required for many UI elements & logic)
                await fetchAvailableTokens();

                // Initialize User Data (Profile, Balances) and Setup Listeners
                await initializeFirebaseAndUser();

                // Show the initial page (Home) - this triggers transaction fetch
                showPage('home-page');

            } else {
                // Critical error: Cannot proceed without user data
                throw new Error("Could not retrieve valid Telegram user data.");
            }

            hideLoading(); // Hide loading overlay ONLY on full success
            console.log("AB Wallet Initialized Successfully.");

        } catch (error) {
            // Handle critical initialization errors
            console.error("CRITICAL INITIALIZATION FAILURE:", error);
            handleFirebaseError(error, "App Initialization");
            showLoading("Error Loading Wallet"); // Keep loading showing error
            disableAppFeatures(); // Disable buttons etc.
            // Display persistent error message in main content area
            if(elements.mainContent) elements.mainContent.innerHTML = `<div class="card status-message error" style="margin: 40px auto; text-align: center;">Failed to initialize AB Wallet.<br>Please close and reopen the app.<br><small>(${error.message || 'Unknown error'})</small></div>`;
        }
    }

    // Start the application initialization process
    startApp();

}); // End DOMContentLoaded
