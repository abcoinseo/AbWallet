// @ts-check

/**
 * AB Wallet - firebase.js
 *
 * Handles Firebase interaction, application logic, and UI updates for the
 * AB Wallet Telegram Web App.
 *
 * WARNING: THIS IS A CLIENT-SIDE IMPLEMENTATION FOR DEMONSTRATION PURPOSES ONLY.
 * It performs financial operations directly from the client, which is INSECURE.
 * A secure backend is REQUIRED for a production application handling real value.
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration ---
    // WARNING: Ensure Firebase rules are SECURE for production. DEMO uses insecure rules.
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
    const DEBOUNCE_DELAY = 350; // Slightly longer debounce for calculations
    const PRECISION = 8; // Decimal places for storing non-USD balances
    const RECENT_TRANSACTIONS_LIMIT = 20; // Show more transactions

    // --- Globals ---
    const tg = window.Telegram.WebApp;
    /** @type {any | null} Current Telegram User object */
    let currentUser = null;
    /** @type {Object.<string, number>} User's token balances */
    let userBalances = {};
    /** @type {Object.<string, {name: string, symbol: string, priceUSD: number, logoUrl: string}>} Available token definitions */
    let availableTokens = {};
    /** @type {firebase.app.App | null} Firebase App instance */
    let firebaseApp = null;
    /** @type {firebase.database.Database | null} Firebase Database instance */
    let db = null;
    /** @type {firebase.database.Reference | null} Reference to the current user's data */
    let userDbRef = null;
    /** @type {firebase.database.Reference | null} Reference to user's transactions */
    let userTransactionsRef = null;
    /** @type {boolean} Flag for balance listener */
    let balanceListenerAttached = false;
    /** @type {Function | null} Detacher for transaction listener */
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
    /** @type {'from' | 'to' | null} Active token selector modal */
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
    const formatCurrency = (amount) => { /* ... (same as before) ... */ };
    const formatTokenAmount = (amount, decimals = 6) => { /* ... (same as before) ... */ };
    const sanitizeFloat = (value) => parseFloat(String(value).replace(/[^0-9.-]+/g,"")) || 0; // Allow negative for potential future use, strip non-numeric except . and -
    const sanitizeInt = (value) => parseInt(String(value).replace(/[^0-9]+/g,""), 10) || 0; // Strip non-digits
    const debounce = (func, delay) => { /* ... (same as before) ... */ };
    const formatTimestamp = (timestamp) => { /* ... (same as before) ... */ };

    // --- Loading & Alerts ---
    function showLoading(message = "Processing...") { /* ... (same as before) ... */ }
    function hideLoading() { /* ... (same as before) ... */ }
    function showTgAlert(message, title = 'Alert') { /* ... (same as before) ... */ }
    function handleFirebaseError(error, context = "Firebase Operation") { /* ... (same as before) ... */ }

    // --- Navigation & Page Handling ---
    function showPage(pageId) { /* ... (same as before, handles page switching, calls setup functions) ... */ }

    // --- Core Data Handling & UI Updates ---
    async function fetchAvailableTokens() { /* ... (same as before, fetches /tokens) ... */ }
    function updateHomePageUI() { /* ... (same as before, updates assets and total balance) ... */ }
    function displayUserInfo() { /* ... (same as before) ... */ }
    function setupReceivePage() { /* ... (same as before, displays Chat ID) ... */ }

    // --- Transaction History ---
    async function fetchAndDisplayTransactions(limit = RECENT_TRANSACTIONS_LIMIT) { /* ... (same as before) ... */ }
    function createTransactionElement(tx) { /* ... (same as before, creates HTML for TX item) ... */ }

    // --- Firebase Realtime Listeners ---
    function setupBalanceListener() { /* ... (same as before, listens to balance changes, updates relevant UI) ... */ }
    // function setupTransactionListener() { /* ... (Optional listener for live TX updates) ... */ }

    // --- Firebase Initialization and User Setup ---
    async function initializeFirebaseAndUser() { /* ... (same as before, checks/creates user, sets refs, attaches listeners) ... */ }
    function disableAppFeatures() { /* ... (disables buttons on critical error) ... */ }


    // --- Swap Functionality (Client-Side Simulation) ---

    /** Opens the token selection modal. */
    function openTokenModal(selectorType) {
        if (!elements.tokenModal) return;
        activeTokenSelector = selectorType;
        populateTokenListModal(); // Refresh list
        if(elements.tokenSearchInput) elements.tokenSearchInput.value = '';
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
            .sort((a, b) => a.name.localeCompare(b.name))
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
                 // Prevent selecting the same token as the *other* side directly from list
                 const otherTokenSymbol = activeTokenSelector === 'from' ? swapState.toToken : swapState.fromToken;
                 if (token.symbol === otherTokenSymbol) {
                    li.style.opacity = '0.5';
                    li.style.cursor = 'not-allowed';
                 } else {
                    li.addEventListener('click', () => handleTokenSelection(token.symbol));
                 }
                elements.tokenListModal.appendChild(li);
            });
    }


    /** Handles selection of a token from the modal. */
    function handleTokenSelection(selectedSymbol) {
        if (!activeTokenSelector || !selectedSymbol) return;
        console.log(`Token selected: ${selectedSymbol} for ${activeTokenSelector}`);

        // Update the correct part of the state
        swapState[activeTokenSelector === 'from' ? 'fromToken' : 'toToken'] = selectedSymbol;

        closeTokenModal();
        calculateSwapRate(); // Recalculate rate and amounts with the new token
    }

    /** Updates the UI of a token selector button (image, symbol). */
    function updateTokenButtonUI(buttonElement, tokenSymbol) {
        if (!buttonElement) return;
        const tokenInfo = tokenSymbol ? availableTokens[tokenSymbol] : null;
        const logoElement = buttonElement.querySelector('.token-logo');
        const symbolElement = buttonElement.querySelector('.token-symbol');

        if (tokenInfo && logoElement && symbolElement) {
            logoElement.src = tokenInfo.logoUrl || 'placeholder.png';
            logoElement.alt = tokenInfo.symbol;
            symbolElement.textContent = tokenInfo.symbol;
             buttonElement.disabled = false; // Ensure button is enabled if token selected
        } else if (logoElement && symbolElement) { // Reset to placeholder
            logoElement.src = 'placeholder.png'; logoElement.alt = '-';
            symbolElement.textContent = 'Select';
             buttonElement.disabled = false; // Ensure button is enabled to allow selection
        }
         // Disable the other button temporarily if it shows the same token (should be swapped by switch)
         const otherButton = buttonElement === elements.swapFromTokenButton ? elements.swapToTokenButton : elements.swapFromTokenButton;
         const otherSymbol = buttonElement === elements.swapFromTokenButton ? swapState.toToken : swapState.fromToken;
         if (otherButton && tokenSymbol && tokenSymbol === otherSymbol) {
             // This state shouldn't really happen with the switch logic, but as a safety
             // console.warn("Both selectors show the same token, consider disabling one?");
         }
    }

    /** Updates the 'Balance:' text displays under swap inputs. */
    function updateSwapBalancesUI() {
        if (elements.swapFromBalance && swapState.fromToken) {
            const balance = userBalances[swapState.fromToken] || 0;
            elements.swapFromBalance.textContent = `Balance: ${formatTokenAmount(balance, swapState.fromToken === 'USD' ? 2 : 6)}`;
            elements.swapFromBalance.style.color = ''; // Reset color
        } else if (elements.swapFromBalance) { elements.swapFromBalance.textContent = 'Balance: -'; }

        if (elements.swapToBalance && swapState.toToken) {
            const balance = userBalances[swapState.toToken] || 0;
            elements.swapToBalance.textContent = `Balance: ${formatTokenAmount(balance, swapState.toToken === 'USD' ? 2 : 6)}`;
        } else if (elements.swapToBalance) { elements.swapToBalance.textContent = 'Balance: -'; }
    }

    /** Sets default 'from'/'to' tokens if needed. */
    function populateTokenSelectors() {
        const symbols = Object.keys(availableTokens);
        if (symbols.length === 0) {
            console.warn("Cannot populate swap selectors: No tokens available.");
            return;
        }

        // Set default 'From' token (prefer USD if available)
        if (!swapState.fromToken) {
            swapState.fromToken = symbols.includes('USD') ? 'USD' : symbols[0];
        }
        // Set default 'To' token (different from 'From')
        if (!swapState.toToken && symbols.length > 1) {
            swapState.toToken = symbols.find(s => s !== swapState.fromToken) || symbols.find(s => s !== null); // Find first different token
        }

        console.log("Populated swap selectors defaults:", swapState.fromToken, swapState.toToken);
        updateTokenButtonUI(elements.swapFromTokenButton, swapState.fromToken);
        updateTokenButtonUI(elements.swapToTokenButton, swapState.toToken);
    }


    /** Calculates the base swap rate (priceFrom / priceTo) without fees. */
    function calculateSwapRate() {
        const { fromToken, toToken } = swapState;
        swapState.rate = 0; // Reset rate

        // Don't calculate if tokens are missing or the same
        if (!fromToken || !toToken || fromToken === toToken || !availableTokens[fromToken] || !availableTokens[toToken]) {
            swapState.isRateLoading = false;
            calculateSwapAmounts(); // Update UI (amounts will be 0)
            if (elements.swapRateDisplay) {
                elements.swapRateDisplay.textContent = (fromToken && toToken && fromToken === toToken) ? 'Select different tokens' : 'Select tokens';
                elements.swapRateDisplay.classList.remove('error', 'loading');
            }
            return;
        }

        swapState.isRateLoading = true;
        if(elements.swapRateDisplay) {
             elements.swapRateDisplay.textContent = 'Calculating rate...';
             elements.swapRateDisplay.classList.add('loading');
             elements.swapRateDisplay.classList.remove('error');
        }
        // Update UI immediately to show loading state for rate
        updateSwapUI();

        // Simulate potential async fetch if needed in future, but use direct calculation here
        const fromPrice = availableTokens[fromToken].priceUSD || 0;
        const toPrice = availableTokens[toToken].priceUSD || 0;

        if (fromPrice <= 0 || toPrice <= 0) {
            console.error("Cannot calculate rate: Zero or missing price for", fromToken, "or", toToken);
            swapState.isRateLoading = false;
            calculateSwapAmounts(); // Update UI (amounts will be 0)
            if(elements.swapRateDisplay) {
                 elements.swapRateDisplay.textContent = 'Rate unavailable (price error)';
                 elements.swapRateDisplay.classList.add('error');
                 elements.swapRateDisplay.classList.remove('loading');
            }
            return;
        }

        swapState.rate = fromPrice / toPrice;
        swapState.isRateLoading = false;
        console.log(`Calculated base rate 1 ${fromToken} = ${swapState.rate} ${toToken}`);
        calculateSwapAmounts(); // Now calculate final 'to' amount including fees
    }


    /** Calculates the estimated 'to' amount based on 'from' amount, rate, and fee. */
    function calculateSwapAmounts() {
        const { fromToken, toToken, fromAmount, rate } = swapState;
        swapState.toAmount = 0; // Reset

        if (!fromToken || !toToken || fromToken === toToken || !fromAmount || fromAmount <= 0 || rate <= 0) {
            updateSwapUI(); // Update UI to show 0 'to' amount and potentially disabled button
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
        console.log(`Calculated toAmount (after fee): ${swapState.toAmount} ${toToken}`);
        updateSwapUI(); // Update all swap UI elements with new amounts
    }

    /** Debounced wrapper for calculateSwapAmounts. */
    const debouncedCalculateSwapAmounts = debounce(calculateSwapAmounts, DEBOUNCE_DELAY);

    /** Handles input changes in the 'from' amount field. */
    function handleFromAmountChange() {
        if (!elements.swapFromAmountInput) return;
        swapState.fromAmount = sanitizeFloat(elements.swapFromAmountInput.value);
        // Trigger debounced calculation of the 'to' amount
        debouncedCalculateSwapAmounts();
    }

    /** Switches the 'from' and 'to' tokens and attempts to preserve value. */
    function switchSwapTokens() {
        console.log("Switching swap tokens");
        const tempToken = swapState.fromToken;
        const tempAmount = swapState.fromAmount; // Store old from amount

        swapState.fromToken = swapState.toToken;
        swapState.toToken = tempToken;

        // Set the new 'from' amount based on the old 'to' amount estimate
        // If old 'to' amount was 0, reset 'from' amount to 0 as well
        swapState.fromAmount = swapState.toAmount > 0 ? swapState.toAmount : 0;

        // Clear the old 'to' amount display immediately
        swapState.toAmount = 0;
        if (elements.swapToAmountInput) elements.swapToAmountInput.value = '';
        if (elements.swapFromAmountInput) elements.swapFromAmountInput.value = swapState.fromAmount > 0 ? swapState.fromAmount : '';


        // Recalculate rate and amounts based on the new direction and amount
        calculateSwapRate();
    }

    /** Validates swap inputs and enables/disables the swap button. */
    function validateSwapInput() {
        if (!elements.executeSwapButton) return;
        const { fromToken, toToken, fromAmount, toAmount } = swapState;
        const currentBalance = userBalances[fromToken] || 0;
        const hasSufficientBalance = currentBalance >= fromAmount;

        const isValid = !!(fromToken && toToken && fromToken !== toToken && fromAmount > 0 && toAmount > 0 && hasSufficientBalance);

        elements.executeSwapButton.disabled = !isValid;

        // Visual feedback for insufficient balance
        if (elements.swapFromBalance) {
            elements.swapFromBalance.style.color = (fromToken && fromAmount > 0 && !hasSufficientBalance) ? 'var(--error-color)' : '';
        }
    }

    /** Updates all UI elements on the swap page based on current swapState. */
    function updateSwapUI() {
        console.log("Updating Swap UI, State:", swapState);
        // Update token selector buttons
        updateTokenButtonUI(elements.swapFromTokenButton, swapState.fromToken);
        updateTokenButtonUI(elements.swapToTokenButton, swapState.toToken);

        // Update amount inputs (avoid resetting if focused)
        if (elements.swapFromAmountInput && document.activeElement !== elements.swapFromAmountInput) {
             elements.swapFromAmountInput.value = swapState.fromAmount > 0 ? String(swapState.fromAmount) : ''; // Use String() to avoid potential issues
        }
        if (elements.swapToAmountInput) {
            const decimals = swapState.toToken === 'USD' ? 2 : 6;
            elements.swapToAmountInput.value = swapState.toAmount > 0 ? formatTokenAmount(swapState.toAmount, decimals) : '';
        }

        updateSwapBalancesUI(); // Update 'Balance:' text

        // Update rate display
        if (elements.swapRateDisplay) {
            elements.swapRateDisplay.classList.remove('error', 'loading');
            if (swapState.isRateLoading) {
                elements.swapRateDisplay.textContent = 'Calculating rate...';
                 elements.swapRateDisplay.classList.add('loading');
            } else if (swapState.rate > 0 && swapState.fromToken && swapState.toToken) {
                elements.swapRateDisplay.textContent = `1 ${swapState.fromToken} ≈ ${formatTokenAmount(swapState.rate)} ${swapState.toToken}`;
            } else if (swapState.fromToken && swapState.toToken && swapState.fromToken === swapState.toToken) {
                 elements.swapRateDisplay.textContent = 'Select different tokens';
            } else if (swapState.fromToken && swapState.toToken) {
                 elements.swapRateDisplay.textContent = 'Rate unavailable'; // Price error likely
            } else {
                elements.swapRateDisplay.textContent = 'Select tokens';
            }
        }

        validateSwapInput(); // Check button state after updates
    }


    /** Executes the swap (INSECURE CLIENT-SIDE SIMULATION). */
    async function executeSwap() {
        // WARNING: INSECURE - REQUIRES BACKEND IMPLEMENTATION FOR PRODUCTION
        if (!userDbRef || !currentUser || !db || !elements.executeSwapButton || elements.executeSwapButton.disabled) {
            console.warn("Swap execution prevented."); return;
        }

        const { fromToken, toToken, fromAmount, toAmount, rate } = swapState;
        const currentFromBalance = userBalances[fromToken] || 0; // Get fresh balance state

        // Final validation using current balance state
        if (!fromToken || !toToken || fromAmount <= 0 || toAmount <= 0 || currentFromBalance < fromAmount) {
            showTgAlert("Swap details are invalid or you have insufficient balance.", "Swap Error");
            validateSwapInput(); // Re-validate button
            return;
        }

        console.log(`Executing swap: ${fromAmount} ${fromToken} -> ${toAmount} ${toToken}`);
        showLoading("Processing Swap...");
        elements.executeSwapButton.disabled = true;
        if (elements.swapStatus) { elements.swapStatus.textContent = 'Processing...'; elements.swapStatus.className = 'status-message pending'; }

        const newFromBalance = currentFromBalance - fromAmount;
        const currentToBalance = userBalances[toToken] || 0; // Get recipient token balance
        const newToBalance = currentToBalance + toAmount; // Use the fee-adjusted 'toAmount'

        // ** INSECURE PART: Preparing multi-location update from client **
        const updates = {};
        const userId = currentUser.id.toString();
        updates[`/users/${userId}/balances/${fromToken}`] = sanitizeFloat(newFromBalance.toFixed(PRECISION));
        updates[`/users/${userId}/balances/${toToken}`] = sanitizeFloat(newToBalance.toFixed(PRECISION));

        const txData = { /* ... tx details ... */ timestamp: firebase.database.ServerValue.TIMESTAMP, status: 'completed' };
        const newTxKey = db.ref(`/transactions/${userId}`).push().key;
        if (newTxKey) { updates[`/transactions/${userId}/${newTxKey}`] = txData; }
        else { console.error("Failed to generate transaction key!"); }
        // ** END INSECURE PART **

        try {
            console.log("Attempting Firebase update:", updates);
            await db.ref().update(updates); // Attempt atomic update
            console.log("Swap successful (Client-side simulation).");
            if (elements.swapStatus) { elements.swapStatus.textContent = 'Swap Successful!'; elements.swapStatus.className = 'status-message success'; }
            // Reset form after success display
            setTimeout(() => {
                swapState.fromAmount = 0;
                swapState.toAmount = 0;
                updateSwapUI(); // Reset inputs and re-validate button
                if (elements.swapStatus) elements.swapStatus.textContent = '';
            }, 2500);
        } catch (error) {
            handleFirebaseError(error, "executing swap");
            if (elements.swapStatus) { elements.swapStatus.textContent = 'Swap Failed. Please try again.'; elements.swapStatus.className = 'status-message error'; }
            // Consider explicitly re-enabling the button here if needed, though validate should handle it
            validateSwapInput();
        } finally {
            hideLoading();
        }
    }

    /** Prepares the swap page UI when navigated to. */
    function setupSwapPage() {
        console.log("Setting up Swap Page");
        // Reset amounts, maybe keep tokens? Let's keep tokens.
        swapState.fromAmount = 0;
        swapState.toAmount = 0;
        if (elements.swapFromAmountInput) elements.swapFromAmountInput.value = '';
        if (elements.swapToAmountInput) elements.swapToAmountInput.value = '';

        // Ensure token selectors are populated if tokens exist
        if (Object.keys(availableTokens).length > 0) {
             populateTokenSelectors();
        }
        calculateSwapRate(); // Calculate rate for current/default tokens
        if(elements.swapStatus) elements.swapStatus.textContent = ''; // Clear any previous status
    }


    // --- Internal Send Functionality (Client-Side Simulation) ---

    /** Populates the asset dropdown on the Send page. */
    function updateWithdrawAssetSelector() {
        if (!elements.withdrawAssetSelect) return;
        const currentSelection = elements.withdrawAssetSelect.value; // Preserve selection
        elements.withdrawAssetSelect.innerHTML = '<option value="">-- Select Asset --</option>'; // Clear

        Object.keys(availableTokens)
            .sort() // Alphabetical sort
            .forEach(symbol => {
                const tokenInfo = availableTokens[symbol];
                if (tokenInfo) {
                    const option = document.createElement('option');
                    option.value = symbol;
                    option.textContent = `${tokenInfo.name} (${symbol})`;
                    elements.withdrawAssetSelect.appendChild(option);
                }
            });

        // Restore selection if possible and valid
        if (currentSelection && availableTokens[currentSelection]) {
            elements.withdrawAssetSelect.value = currentSelection;
        } else {
             elements.withdrawAssetSelect.value = ""; // Reset if invalid
        }
        updateWithdrawPageBalance(); // Update balance display for the asset
    }

    /** Updates the 'Available' balance text on the Send page. */
    function updateWithdrawPageBalance() {
        if (!elements.withdrawAvailableBalance || !elements.withdrawAssetSelect) return;
        const selectedSymbol = elements.withdrawAssetSelect.value;
        const balance = userBalances[selectedSymbol] || 0;
        const decimals = selectedSymbol === 'USD' ? 2 : 6;
        elements.withdrawAvailableBalance.textContent = `${formatTokenAmount(balance, decimals)} ${selectedSymbol || ''}`;
        if (elements.withdrawMaxButton) elements.withdrawMaxButton.disabled = balance <= 0;
        validateSendInput(); // Re-validate inputs as balance might affect validity
    }

    /** Validates inputs on the Send page and updates button/status. */
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

        if (!selectedSymbol) isValid = false;
        else if (amount <= 0) isValid = false;
        else if (amount > balance) { isValid = false; statusMsg = 'Amount exceeds available balance.'; elements.withdrawStatus.className = 'status-message error'; }
        else if (!recipientIdStr) isValid = false;
        // Basic numeric check for Chat ID - enhance if needed
        else if (!/^\d+$/.test(recipientIdStr) || recipientId <= 0) { isValid = false; statusMsg = 'Invalid Recipient Chat ID (must be numeric).'; elements.withdrawStatus.className = 'status-message error'; }
        else if (currentUser && recipientId === currentUser.id) { isValid = false; statusMsg = 'You cannot send funds to yourself.'; elements.withdrawStatus.className = 'status-message error'; }

        elements.sendButton.disabled = !isValid;
        // Show status message only if there's an actual error to display
        elements.withdrawStatus.textContent = statusMsg;
    }

    /** Executes the internal transfer (INSECURE CLIENT-SIDE SIMULATION). */
    async function handleSend() {
        // WARNING: INSECURE - REQUIRES BACKEND IMPLEMENTATION FOR PRODUCTION
        if (!userDbRef || !currentUser || !db || !elements.sendButton || elements.sendButton.disabled) {
             console.warn("Send execution prevented."); return;
        }

        const selectedSymbol = elements.withdrawAssetSelect?.value;
        const recipientId = sanitizeInt(elements.withdrawRecipientIdInput?.value);
        const amount = sanitizeFloat(elements.withdrawAmountInput?.value);
        const senderId = currentUser.id;
        const senderBalance = userBalances[selectedSymbol] || 0; // Use current state

        // Final client validation
        if (!selectedSymbol || amount <= 0 || !recipientId || recipientId === senderId || senderBalance < amount) {
            showTgAlert("Invalid send details or insufficient funds.", "Send Error"); validateSendInput(); return;
        }

        console.log(`Attempting to send ${amount} ${selectedSymbol} from ${senderId} to ${recipientId}`);
        showLoading("Processing Transfer...");
        elements.sendButton.disabled = true;
        if (elements.withdrawStatus) { elements.withdrawStatus.textContent = 'Verifying recipient...'; elements.withdrawStatus.className = 'status-message pending'; }

        // --- INSECURE CLIENT-SIDE RECIPIENT CHECK ---
        const recipientRef = db.ref(`users/${recipientId}`);
        let recipientExists = false;
        try {
            const recipientSnapshot = await recipientRef.child('profile').once('value'); // Check if profile exists
            recipientExists = recipientSnapshot.exists();
            if(!recipientExists) console.warn(`Recipient check failed: User ${recipientId} profile not found.`);
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
        try { // Fetch recipient balance just before write (still has race condition risk client-side)
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
        if (txId) { /* ... create senderTx and receiverTx ... */ }
        else { console.error("Failed to generate TX ID!"); /* Handle */ }
        // --- END INSECURE UPDATE ---

        try {
            console.log("Attempting Firebase update for send:", updates);
            await db.ref().update(updates); // Attempt multi-path update
            console.log("Internal transfer successful (simulated).");
            if (elements.withdrawStatus) { elements.withdrawStatus.textContent = 'Funds Sent Successfully!'; elements.withdrawStatus.className = 'status-message success'; }
            if(elements.withdrawAmountInput) elements.withdrawAmountInput.value = '';
            if(elements.withdrawRecipientIdInput) elements.withdrawRecipientIdInput.value = '';
            setTimeout(() => { if (elements.withdrawStatus) elements.withdrawStatus.textContent = ''; }, 3000);
        } catch (error) { handleFirebaseError(error, "executing internal transfer"); if (elements.withdrawStatus) { elements.withdrawStatus.textContent = 'Send Failed.'; elements.withdrawStatus.className = 'status-message error'; }
        } finally { hideLoading(); validateSendInput(); } // Re-validate button state
    }

    /** Prepares the Send page UI. */
    function setupSendPage() {
        console.log("Setting up Send Page");
        if(elements.withdrawAssetSelect) updateWithdrawAssetSelector();
        if(elements.withdrawAmountInput) elements.withdrawAmountInput.value = '';
        if(elements.withdrawRecipientIdInput) elements.withdrawRecipientIdInput.value = '';
        if(elements.withdrawStatus) { elements.withdrawStatus.textContent = ''; elements.withdrawStatus.className = 'status-message'; }
        updateWithdrawPageBalance(); // Includes initial validation
    }


    // --- Event Listeners Setup ---
    /** Attaches all necessary event listeners for the application. */
    function setupEventListeners() {
        console.log("Attaching event listeners...");
        // Navigation
        elements.navButtons.forEach(button => button.addEventListener('click', () => { if (!button.classList.contains('active')) showPage(button.dataset.page); }));
        elements.backButtons.forEach(button => button.addEventListener('click', () => showPage(button.dataset.target || 'home-page')));
        if (elements.refreshButton) elements.refreshButton.addEventListener('click', async () => { /* ... Refresh logic ... */ });
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
        if (elements.withdrawMaxButton) elements.withdrawMaxButton.addEventListener('click', () => {
             const selectedSymbol = elements.withdrawAssetSelect?.value;
             if (selectedSymbol && elements.withdrawAmountInput) {
                 const balance = userBalances[selectedSymbol] || 0;
                 elements.withdrawAmountInput.value = balance > 0 ? String(balance) : ''; // Use String()
                 validateSendInput(); // Validate after setting
             }
         });
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
            await tg.ready(); // IMPORTANT: Wait for SDK readiness
            tg.expand();
            tg.enableClosingConfirmation();
            console.log("Telegram WebApp SDK Ready. Theme:", tg.themeParams);

            // Basic Theme application (CSS handles dark mode primarily)
            document.body.style.setProperty('--tg-theme-bg-color', tg.themeParams.bg_color || '#16181a');
            document.body.style.setProperty('--tg-theme-text-color', tg.themeParams.text_color || '#e8e8e8');
            // ... map other themeParams if needed ...

            // Attach event listeners once DOM is ready
            setupEventListeners();

            // Get Telegram User Data
            // IMPORTANT: Use initDataUnsafe for display ONLY. Validate initData securely on backend.
            if (tg.initDataUnsafe?.user) {
                currentUser = tg.initDataUnsafe.user;
                console.log(`User Identified: ${currentUser.id} (${currentUser.username || 'No username'})`);
                displayUserInfo(); // Show basic info quickly

                // Initialize Firebase App & Database connection
                if (!firebase.apps.length) { firebaseApp = firebase.initializeApp(firebaseConfig); }
                else { firebaseApp = firebase.app(); }
                db = firebase.database();
                if(!db) throw new Error("Firebase Database initialization failed.");
                console.log("Firebase Initialized.");

                // Fetch essential static data (token definitions) BEFORE loading user data that might depend on it
                await fetchAvailableTokens();

                // Initialize user-specific data (profile, balances) and Setup Listeners
                await initializeFirebaseAndUser();

                // Show the initial page (Home), triggering its data loads
                showPage('home-page');

            } else {
                // Critical error if user data is missing
                throw new Error("Could not retrieve valid Telegram user data. App cannot function.");
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

    // Start the application initialization process
    startApp();

}); // End DOMContentLoaded
