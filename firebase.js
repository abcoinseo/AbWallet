document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration ---
    const firebaseConfig = { /* ... Your Config ... */ };

    // --- Globals ---
    const tg = window.Telegram.WebApp;
    let currentUser = null;
    let userBalances = {};
    let availableTokens = {};
    let firebaseApp = null;
    let db = null;
    let userDbRef = null;
    let balanceListenerAttached = false;
    const SWAP_FEE_PERCENT = 0.1; // 0.1%

    // Swap state
    let swapState = { fromToken: null, toToken: null, fromAmount: 0, toAmount: 0, rate: 0, fee: 0, isRateLoading: false };
    let activeTokenSelector = null;

    // --- DOM Elements (Ensure all are correctly selected) ---
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
    const swapToAmountInput = document.getElementById('swap-to-amount'); // Now readonly text input
    const swapFromTokenButton = document.getElementById('swap-from-token-button');
    const swapToTokenButton = document.getElementById('swap-to-token-button');
    const swapFromBalance = document.getElementById('swap-from-balance');
    const swapToBalance = document.getElementById('swap-to-balance');
    const swapSwitchButton = document.getElementById('swap-switch-button');
    const swapRateDisplay = document.getElementById('swap-rate-display');
    const swapFeeDisplay = document.getElementById('swap-fee-display'); // New element for fee value
    const executeSwapButton = document.getElementById('execute-swap-button');
    const swapStatus = document.getElementById('swap-status');
    // Token Modal
    const tokenModal = document.getElementById('token-selector-modal');
    const tokenSearchInput = document.getElementById('token-search-input');
    const tokenListModal = document.getElementById('token-list-modal');
    const closeModalButton = tokenModal?.querySelector('.close-modal-button');


    // --- Utility Functions (Keep as before) ---
    const formatCurrency = (amount) => { /* ... */ };
    const formatTokenAmount = (amount, decimals = 6) => { /* ... */ };
    const sanitizeFloat = (value) => parseFloat(value) || 0;
    const sanitizeInt = (value) => parseInt(value, 10) || 0;


    // --- Loading & Alerts (Keep as before) ---
    function showLoading(message = "Loading...") { /* ... */ }
    function hideLoading() { /* ... */ }
    function showTgAlert(message, title = 'Info') { /* ... */ }
    function handleFirebaseError(error, context = "Firebase operation") { /* ... */ }


    // --- Navigation & Page Handling (Keep as before) ---
    function showPage(pageId) { /* ... */ }


    // --- Core Data Handling & UI Updates (Keep as before) ---
    async function fetchAvailableTokens() { /* ... */ }
    function updateHomePageUI() { /* ... */ }
    function displayUserInfo() { /* ... */ }
    function setupReceivePage() { /* ... */ }


    // --- Firebase Realtime Updates (Keep as before) ---
    function setupBalanceListener() { /* ... */ }


    // --- Firebase Initialization (Keep as before) ---
    async function initializeFirebaseAndUser() { /* ... */ }
    function disableAppFeatures() { /* ... */ }


    // --- Swap Functionality (Updated for UI) ---
    function openTokenModal(selectorType) { /* ... */ }
    function closeTokenModal() { /* ... */ }
    function populateTokenListModal(searchTerm = '') { /* ... */ }
    function handleTokenSelection(selectedSymbol) { /* ... (logic remains same) ... */ }
    function updateTokenButtonUI(buttonElement, tokenSymbol) { /* ... */ }
    function updateSwapBalancesUI() { /* ... */ }
    function populateTokenSelectors() { /* ... */ }

    /** Calculates the swap rate (Rate doesn't include fee) */
    function calculateSwapRate() {
        // ... (Same logic as before to calculate swapState.rate) ...
        swapState.isRateLoading = true; // Indicate loading
        // Simulate slight delay maybe if fetching prices in future
        setTimeout(() => {
            const { fromToken, toToken } = swapState;
            swapState.rate = 0; // Reset rate
            if (fromToken && toToken && availableTokens[fromToken] && availableTokens[toToken]) {
                const fromPrice = availableTokens[fromToken].priceUSD || 0;
                const toPrice = availableTokens[toToken].priceUSD || 0;
                if (fromPrice > 0 && toPrice > 0) {
                    swapState.rate = fromPrice / toPrice;
                } else { console.error("Cannot calc rate, zero price."); }
            }
            swapState.isRateLoading = false;
            calculateSwapAmounts(); // Recalculate amounts based on new rate
        }, 50); // Small delay to allow UI update for loading state
    }

    /** Calculates the From/To amounts INCLUDING the fee */
    function calculateSwapAmounts() {
        const { fromToken, toToken, fromAmount, rate } = swapState;
        swapState.toAmount = 0; // Reset 'to' amount
        swapState.fee = 0; // Reset fee amount

        if (!fromToken || !toToken || !fromAmount || fromAmount <= 0 || rate <= 0) {
            updateSwapUI(); // Update UI even if amounts are zero
            return;
        }

        let calculatedToAmount = 0;
        let feeAmount = 0;
        const feeMultiplier = SWAP_FEE_PERCENT / 100;

        // Fee is typically calculated on the input amount or the output value *before* fees
        const inputFee = fromAmount * feeMultiplier; // Fee amount in terms of the input token

        if (fromToken === 'USD') { // Buying Coin (USD -> Other)
            const amountAfterFee = fromAmount - inputFee; // Deduct fee in USD first
            calculatedToAmount = amountAfterFee * rate;
            feeAmount = inputFee; // Fee was in USD
        } else if (toToken === 'USD') { // Selling Coin (Other -> USD)
            calculatedToAmount = (fromAmount * rate) * (1 - feeMultiplier); // Deduct fee from the resulting USD
            feeAmount = (fromAmount * rate) * feeMultiplier; // Fee is in USD
        } else { // Coin to Coin (e.g., ABT -> BTC)
            const baseToAmount = fromAmount * rate;
            calculatedToAmount = baseToAmount * (1 - feeMultiplier); // Deduct fee from the output coin amount
            // Fee equivalent in 'from' token (inputFee) or 'to' token (baseToAmount * feeMultiplier)
            // Let's store fee equivalent in 'from' token for consistency
            feeAmount = inputFee;
        }

        swapState.toAmount = calculatedToAmount > 0 ? calculatedToAmount : 0;
        swapState.fee = feeAmount > 0 ? feeAmount : 0; // Store calculated fee
        updateSwapUI(); // Update all swap UI elements
    }

    function handleFromAmountChange() {
        swapState.fromAmount = sanitizeFloat(swapFromAmountInput.value);
        calculateSwapAmounts(); // Recalculate output and fee, update UI
    }

    function switchSwapTokens() {
        // ... (Swap tokens in swapState) ...
        const tempToken = swapState.fromToken;
        swapState.fromToken = swapState.toToken;
        swapState.toToken = tempToken;
        // Reset amounts when switching
        swapState.fromAmount = 0;
        if(swapFromAmountInput) swapFromAmountInput.value = '';
        calculateSwapRate(); // Recalculate rate and amounts (will be 0 initially)
    }

    function validateSwapInput() {
        // ... (Same logic as before) ...
        const { fromToken, toToken, fromAmount, toAmount } = swapState;
         const hasSufficientBalance = (userBalances[fromToken] || 0) >= fromAmount;
         // Ensure fee calculation doesn't make fromAmount effectively zero if fee is high
         const isValid = fromToken && toToken && fromAmount > 0 && toAmount > 0 && hasSufficientBalance;
         if (executeSwapButton) executeSwapButton.disabled = !isValid;
    }

    /** Updates the UI elements on the swap page based on swapState */
    function updateSwapUI() {
        // Update token buttons and balances
        updateTokenButtonUI(swapFromTokenButton, swapState.fromToken);
        updateTokenButtonUI(swapToTokenButton, swapState.toToken);
        updateSwapBalancesUI();

        // Update amount inputs
        // Only set fromAmount if it's not the active input to avoid cursor jumps
        // if (document.activeElement !== swapFromAmountInput) {
        //     swapFromAmountInput.value = swapState.fromAmount > 0 ? swapState.fromAmount : '';
        // }
        // Update readonly 'to' input
        const toDecimals = availableTokens[swapState.toToken]?.symbol === 'USD' ? 2 : 6;
        if(swapToAmountInput) swapToAmountInput.value = swapState.toAmount > 0 ? formatTokenAmount(swapState.toAmount, toDecimals) : '';

        // Update Rate display
        if (swapRateDisplay) {
             if (swapState.isRateLoading) {
                 swapRateDisplay.textContent = `Loading...`;
                 swapRateDisplay.classList.add('loading'); swapRateDisplay.classList.remove('error');
             } else if (swapState.rate > 0 && swapState.fromToken && swapState.toToken) {
                swapRateDisplay.textContent = `1 ${swapState.fromToken} ≈ ${formatTokenAmount(swapState.rate)} ${swapState.toToken}`;
                swapRateDisplay.classList.remove('loading', 'error');
             } else {
                swapRateDisplay.textContent = 'Select tokens';
                swapRateDisplay.classList.remove('loading', 'error');
             }
        }

        // Update Fee display
        if (swapFeeDisplay) {
            if (swapState.fee > 0 && swapState.fromToken) {
                 // Display fee in the 'from' token's currency for simplicity
                const feeDecimals = availableTokens[swapState.fromToken]?.symbol === 'USD' ? 2 : 6;
                 swapFeeDisplay.textContent = `≈ ${formatTokenAmount(swapState.fee, feeDecimals)} ${swapState.fromToken}`;
                 swapFeeDisplay.classList.remove('error');
            } else {
                 swapFeeDisplay.textContent = '-';
                 swapFeeDisplay.classList.remove('error');
            }
        }

        validateSwapInput(); // Check button state after UI updates
    }

    /** Executes the swap (Simulated & Insecure) */
    async function executeSwap() {
        // ... (Keep validation and INSECURE update logic as before) ...
         if (!userDbRef || !currentUser || !executeSwapButton || executeSwapButton.disabled) return;

        const { fromToken, toToken, fromAmount, toAmount, rate, fee } = swapState; // Include fee
        if (!fromToken || !toToken || fromAmount <= 0 || toAmount <= 0 || (userBalances[fromToken] || 0) < fromAmount) {
            showTgAlert("Invalid swap details or insufficient balance.", "Swap Error"); return;
        }

        showLoading("Processing Swap...");
        executeSwapButton.disabled = true;
        swapStatus.textContent = 'Processing...'; swapStatus.className = 'status-message pending';

        const newFromBalance = (userBalances[fromToken] || 0) - fromAmount;
        const newToBalance = (userBalances[toToken] || 0) + toAmount;

        // ** INSECURE CLIENT-SIDE UPDATE ** Requires Backend
        const updates = {};
        const senderId = currentUser.id;
        updates[`/users/${senderId}/balances/${fromToken}`] = sanitizeFloat(newFromBalance.toFixed(8));
        updates[`/users/${senderId}/balances/${toToken}`] = sanitizeFloat(newToBalance.toFixed(8));

        const txData = { type: 'swap', fromToken, fromAmount, toToken, toAmount, rate, feePercent: SWAP_FEE_PERCENT, feeAmount: fee, timestamp: firebase.database.ServerValue.TIMESTAMP, status: 'completed' };
        const newTxKey = db.ref(`/transactions/${senderId}`).push().key;
        updates[`/transactions/${senderId}/${newTxKey}`] = txData;

        try {
            await db.ref().update(updates);
            swapStatus.textContent = 'Swap Successful!'; swapStatus.className = 'status-message success';
            setTimeout(() => {
                swapState.fromAmount = 0; swapState.toAmount = 0; swapState.fee = 0;
                if(swapFromAmountInput) swapFromAmountInput.value = '';
                updateSwapUI(); // Reset UI display
                swapStatus.textContent = '';
            }, 2500);
        } catch (error) {
            handleFirebaseError(error, "executing swap");
            swapStatus.textContent = 'Swap Failed.'; swapStatus.className = 'status-message error';
        } finally {
            hideLoading();
        }
    }

    function setupSwapPage() {
        swapState.fromAmount = 0; swapState.toAmount = 0; swapState.fee = 0;
        // Keep selected tokens maybe?
        calculateSwapRate(); // Recalculate rate/amounts
        updateSwapUI();
        if(swapStatus) swapStatus.textContent = '';
    }


    // --- Internal Send/Withdraw Functionality (Keep as before) ---
    function updateWithdrawAssetSelector() { /* ... */ }
    function updateWithdrawPageBalance() { /* ... */ }
    function validateSendInput() { /* ... */ }
    async function handleSend() { /* ... (Keep INSECURE logic) ... */ }
    function setupSendPage() { /* ... */ }


    // --- Event Listeners (Keep as before) ---
    navButtons.forEach(button => button.addEventListener('click', () => showPage(button.dataset.page)));
    backButtons.forEach(button => button.addEventListener('click', () => showPage(button.dataset.target || 'home-page')));
    if(refreshButton) refreshButton.addEventListener('click', initializeFirebaseAndUser);
    // Swap Page Listeners
    if(swapFromAmountInput) swapFromAmountInput.addEventListener('input', handleFromAmountChange);
    if(swapSwitchButton) swapSwitchButton.addEventListener('click', switchSwapTokens);
    if(executeSwapButton) executeSwapButton.addEventListener('click', executeSwap);
    if(swapFromTokenButton) swapFromTokenButton.addEventListener('click', () => openTokenModal('from'));
    if(swapToTokenButton) swapToTokenButton.addEventListener('click', () => openTokenModal('to'));
    // Token Modal Listeners
    if (closeModalButton) closeModalButton.addEventListener('click', closeTokenModal);
    if (tokenSearchInput) tokenSearchInput.addEventListener('input', (e) => populateTokenListModal(e.target.value));
    if (tokenModal) tokenModal.addEventListener('click', (e) => { if (e.target === tokenModal) closeTokenModal(); });
    // Send Page Listeners
    if (withdrawAssetSelect) withdrawAssetSelect.addEventListener('change', updateWithdrawPageBalance);
    if (withdrawAmountInput) withdrawAmountInput.addEventListener('input', validateSendInput);
    if (withdrawRecipientIdInput) withdrawRecipientIdInput.addEventListener('input', validateSendInput);
    if (withdrawMaxButton) withdrawMaxButton.addEventListener('click', () => { /* ... */ });
    if(sendButton) sendButton.addEventListener('click', handleSend);


    // --- Initialization ---
    function startApp() {
        console.log("DOM Loaded. Initializing AB Wallet Pro+...");
        tg.ready();
        tg.expand();
        // Apply necessary theme settings if needed based on tg.colorScheme ('dark' or 'light')
        // For now, we force dark via body class.
        console.log("Telegram Scheme:", tg.colorScheme);

        if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
            currentUser = tg.initDataUnsafe.user;
            displayUserInfo();
            initializeFirebaseAndUser();
        } else { /* ... handle no user error ... */ }
        showPage('home-page');
    }
    startApp();

}); // End DOMContentLoaded
