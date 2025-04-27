document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration ---
    const firebaseConfig = {
        apiKey: "AIzaSyBW1WPXUN8DYhT6npZQYoQ3l4J-jFSbzfg", // USE RULES!
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
    const SWAP_FEE_PERCENT = 0.1; // 0.1%

    // Swap state
    let swapState = { fromToken: null, toToken: null, fromAmount: 0, toAmount: 0, rate: 0, isRateLoading: false };
    let activeTokenSelector = null;

    // --- DOM Elements ---
    // ... (Get references to all elements as before) ...
    const loadingOverlay = document.getElementById('loading-overlay');
    const pages = document.querySelectorAll('.page');
    const navButtons = document.querySelectorAll('#bottom-nav .nav-button');
    // ... (Home page elements)
    const assetListContainer = document.getElementById('asset-list');
    const totalBalanceDisplay = document.getElementById('total-balance-display');
    // ... (Deposit page elements)
    const depositChatIdSpan = document.getElementById('deposit-chat-id');
    // ... (Withdraw page elements - note ID changes)
    const withdrawAssetSelect = document.getElementById('withdraw-asset-select');
    const withdrawAvailableBalance = document.getElementById('withdraw-available-balance');
    const withdrawRecipientIdInput = document.getElementById('withdraw-recipient-id'); // Renamed ID
    const withdrawAmountInput = document.getElementById('withdraw-amount');
    const sendButton = document.getElementById('send-button'); // Renamed ID
    const withdrawMaxButton = document.getElementById('withdraw-max-button');
    const withdrawStatus = document.getElementById('withdraw-status'); // Keep ID for status message
    // ... (Swap page elements)
    const swapFromAmountInput = document.getElementById('swap-from-amount');
    const swapToAmountInput = document.getElementById('swap-to-amount');
    const swapRateDisplay = document.getElementById('swap-rate-display');
    const executeSwapButton = document.getElementById('execute-swap-button');
    const swapStatus = document.getElementById('swap-status');
    // ... (Token modal elements) ...

    // --- Utility Functions ---
    const formatCurrency = (amount) => { /* ... */ };
    const formatTokenAmount = (amount, decimals = 6) => { /* ... */ };
    const sanitizeFloat = (value) => parseFloat(value) || 0;
    const sanitizeInt = (value) => parseInt(value, 10) || 0;

    // --- Loading & Alerts ---
    function showLoading(message = "Loading...") { /* ... */ }
    function hideLoading() { /* ... */ }
    function showTgAlert(message, title = 'Info') { /* ... */ }
    function handleFirebaseError(error, context = "Firebase operation") { /* ... */ }

    // --- Navigation & Page Handling ---
    function showPage(pageId) { /* ... (same as before, updates active classes, resets scroll) ... */
        // Page specific setup/reset
        if (pageId === 'home-page') updateHomePageUI();
        if (pageId === 'withdraw-page') setupSendPage(); // Use new setup function name
        if (pageId === 'deposit-page') setupReceivePage(); // Use new setup function name
        if (pageId === 'swap-page') setupSwapPage();
    }

    // --- Core Data Handling & UI Updates ---
    async function fetchAvailableTokens() { /* ... (same as before) ... */ }
    function updateHomePageUI() { /* ... (same as before - displays assets & total balance) ... */ }
    function displayUserInfo() { /* ... (same as before) ... */ }

    /** Sets up the REVEIVE funds page UI (formerly Deposit) */
    function setupReceivePage() {
        if (depositChatIdSpan && currentUser) {
            depositChatIdSpan.textContent = currentUser.id;
            const copyBtn = depositChatIdSpan.nextElementSibling;
            if (copyBtn) copyBtn.dataset.clipboardText = currentUser.id;
        } else if (depositChatIdSpan) {
            depositChatIdSpan.textContent = 'Not available';
        }
    }

    // --- Firebase Realtime Updates ---
    function setupBalanceListener() { /* ... (same as before, updates userBalances and triggers UI updates) ... */ }

    /** Initializes Firebase and User Data */
    async function initializeFirebaseAndUser() { /* ... (same as before, loads tokens, loads/creates user, attaches listener) ... */ }
    function disableAppFeatures() { /* ... */ }


    // --- Swap Functionality (with Fee) ---

    function openTokenModal(selectorType) { /* ... (same) ... */ }
    function closeTokenModal() { /* ... (same) ... */ }
    function populateTokenListModal(searchTerm = '') { /* ... (same) ... */ }
    function handleTokenSelection(selectedSymbol) { /* ... (same logic, calls updateSwapUI) ... */ }
    function updateTokenButtonUI(buttonElement, tokenSymbol) { /* ... (same) ... */ }
    function updateSwapBalancesUI() { /* ... (same) ... */ }
    function populateTokenSelectors() { /* ... (same) ... */ }

    /** Calculates the swap rate and estimated output amount (Rate doesn't include fee) */
    function calculateSwapRate() {
        // ... (Fetch token prices as before) ...
        if (!fromTokenInfo || !toTokenInfo || !fromTokenInfo.priceUSD || !toTokenInfo.priceUSD || toTokenInfo.priceUSD <= 0) {
            // ... (Handle price error) ...
            swapState.rate = 0;
            calculateSwapAmounts(); // Calculate amounts even if rate is 0 (will result in 0)
            return;
        }

        swapState.rate = fromTokenInfo.priceUSD / toTokenInfo.priceUSD;
        calculateSwapAmounts(); // Calculate amounts based on the new rate
    }

    /** Calculates the From/To amounts INCLUDING the fee */
    function calculateSwapAmounts() {
        const { fromToken, toToken, fromAmount, rate } = swapState;

        if (!fromToken || !toToken || !fromAmount || fromAmount <= 0 || rate <= 0) {
            swapState.toAmount = 0;
            updateSwapUI();
            return;
        }

        let calculatedToAmount = 0;
        const feeMultiplier = SWAP_FEE_PERCENT / 100;

        // Applying Fee Logic:
        if (fromToken === 'USD') {
            // Buying Coin (USD -> Other): User pays slightly more USD effectively per coin
            // Or gets slightly fewer coins for their USD.
            const amountAfterFee = fromAmount * (1 - feeMultiplier); // Reduce the input USD by the fee first
            calculatedToAmount = amountAfterFee * rate; // Convert the reduced USD to the target token
        } else if (toToken === 'USD') {
            // Selling Coin (Other -> USD): User gets slightly less USD back per coin.
            calculatedToAmount = (fromAmount * rate) * (1 - feeMultiplier); // Calculate base USD value, then deduct fee
        } else {
            // Coin to Coin (e.g., ABT -> BTC): Apply fee on the output amount
            const baseToAmount = fromAmount * rate;
            calculatedToAmount = baseToAmount * (1 - feeMultiplier);
        }

        swapState.toAmount = calculatedToAmount > 0 ? calculatedToAmount : 0;
        updateSwapUI();
    }


    /** Handles changes in the 'From' amount input */
    function handleFromAmountChange() {
        swapState.fromAmount = sanitizeFloat(swapFromAmountInput.value);
        // Rate doesn't change, but output amount does
        calculateSwapAmounts();
    }

    /** Switches the 'from' and 'to' tokens */
    function switchSwapTokens() {
        // ... (Swap tokens in swapState as before) ...
        // Swap amounts: Set new 'from' amount based on old 'to' amount (estimation)
        const oldToAmount = swapState.toAmount;
        swapState.fromAmount = oldToAmount; // Use the *estimated* output as the new input
        // Need to recalculate the rate and then the *new* output amount
        calculateSwapRate(); // This recalculates rate AND calls calculateSwapAmounts
    }

    /** Updates the UI elements on the swap page based on swapState */
    function updateSwapUI() {
        // ... (Update token buttons, balances as before) ...
        swapFromAmountInput.value = swapState.fromAmount > 0 ? swapState.fromAmount : '';
        swapToAmountInput.value = swapState.toAmount > 0 ? formatTokenAmount(swapState.toAmount) : ''; // Display formatted 'to' amount

        // ... (Update rate display as before - rate itself doesn't show fee) ...
        if (swapState.rate > 0 && swapState.fromToken && swapState.toToken) {
             // Rate display remains the same (base rate)
             swapRateDisplay.textContent = `1 ${swapState.fromToken} ≈ ${formatTokenAmount(swapState.rate)} ${swapState.toToken}`;
        } else { /* ... handle no rate/loading ... */ }

        // ... (Update executeSwapButton disabled state based on fromAmount > 0, toAmount > 0, and sufficient balance) ...
        executeSwapButton.disabled = !(
             swapState.fromToken &&
             swapState.toToken &&
             swapState.fromAmount > 0 &&
             swapState.toAmount > 0 && // Ensure calculated output is positive
             (userBalances[swapState.fromToken] || 0) >= swapState.fromAmount
         );
    }


    /** Executes the swap (Simulated & Insecure) including fees */
    async function executeSwap() {
        // ... (Initial checks for userDbRef, currentUser, disabled state) ...

        // Use the amounts from swapState, which already include fee calculations
        const { fromToken, toToken, fromAmount, toAmount } = swapState;
        const currentFromBalance = userBalances[fromToken] || 0;

        // ... (Final validation checks: amounts > 0, sufficient balance) ...
        if (currentFromBalance < fromAmount) { /* ... insufficient balance error ... */ return; }

        showLoading("Processing Swap...");
        executeSwapButton.disabled = true;
        swapStatus.textContent = 'Processing...'; // ... set pending class ...

        const newFromBalance = currentFromBalance - fromAmount;
        const currentToBalance = userBalances[toToken] || 0;
        const newToBalance = currentToBalance + toAmount; // Use the fee-adjusted 'toAmount'

        // ** INSECURE: Direct Client-Side Balance Update **
        const balanceUpdates = {};
        balanceUpdates[`/users/${currentUser.id}/balances/${fromToken}`] = sanitizeFloat(newFromBalance.toFixed(8)); // Store with precision
        balanceUpdates[`/users/${currentUser.id}/balances/${toToken}`] = sanitizeFloat(newToBalance.toFixed(8));

        const txData = {
            type: 'swap', fromToken, fromAmount, toToken, toAmount, // Log the actual exchanged amounts
            rate: swapState.rate, // Log the base rate
            feePercent: SWAP_FEE_PERCENT,
            timestamp: firebase.database.ServerValue.TIMESTAMP, status: 'completed'
        };
        const newTxKey = db.ref(`/transactions/${currentUser.id}`).push().key;
        balanceUpdates[`/transactions/${currentUser.id}/${newTxKey}`] = txData;

        try {
            await db.ref().update(balanceUpdates);
            // ... (Success feedback, reset form after delay) ...
            swapStatus.textContent = 'Swap Successful!'; // ... set success class ...
             setTimeout(() => { /* reset state, clear status */ }, 2000);
        } catch (error) {
            handleFirebaseError(error, "executing swap");
             swapStatus.textContent = 'Swap Failed.'; // ... set error class ...
        } finally {
            hideLoading();
            // updateSwapUI(); // Let listener update balances, then re-validate button state
        }
    }

    function setupSwapPage() { /* ... (Reset state, update UI) ... */ }


    // --- Internal Send/Withdraw Functionality ---

    /** Populates the asset selector on the send page */
    function updateWithdrawAssetSelector() { /* ... (same as before) ... */ }

    /** Updates the available balance display on the send page */
    function updateWithdrawPageBalance() {
        // ... (same as before, reads withdrawAssetSelect.value, updates withdrawAvailableBalance) ...
        validateSendInput(); // Use new validation function name
    }

    /** Validates the input fields on the Send Funds page */
    function validateSendInput() {
        const selectedSymbol = withdrawAssetSelect.value;
        const amount = sanitizeFloat(withdrawAmountInput.value);
        const balance = userBalances[selectedSymbol] || 0;
        const recipientIdStr = withdrawRecipientIdInput.value.trim();

        let isValid = true;
        let statusMsg = '';
        withdrawStatus.className = 'status-message'; // Reset status class

        if (!selectedSymbol) {
            isValid = false;
            // No message, just disable button
        } else if (amount <= 0) {
             isValid = false;
             // No message for 0
        } else if (amount > balance) {
            isValid = false;
            statusMsg = 'Amount exceeds available balance.';
            withdrawStatus.className = 'status-message error';
        } else if (!recipientIdStr) {
             isValid = false;
             // No message until trying to send
        } else if (!/^\d+$/.test(recipientIdStr)) { // Basic check for digits only
            isValid = false;
             statusMsg = 'Recipient Chat ID must be a number.';
             withdrawStatus.className = 'status-message error';
        } else if (currentUser && sanitizeInt(recipientIdStr) === currentUser.id) {
             isValid = false;
             statusMsg = 'You cannot send funds to yourself.';
             withdrawStatus.className = 'status-message error';
        }

        sendButton.disabled = !isValid; // Use the renamed button ID maybe? Or keep withdrawButton ID? Let's assume sendButton ID is used in HTML now.
        if (statusMsg && (amount > 0 || recipientIdStr)) { // Show status if user is typing valid numbers or ID
            withdrawStatus.textContent = statusMsg;
        } else if (!isValid && !sendButton.disabled) {
            // Clear status if input becomes invalid silently
            withdrawStatus.textContent = '';
        }
    }

    /** Handles the internal transfer process (Simulated & Insecure) */
    async function handleSend() {
        if (!userDbRef || !currentUser || !db) { showTgAlert("User or database connection missing.", "Send Error"); return; }
        if (sendButton.disabled) { return; }

        const selectedSymbol = withdrawAssetSelect.value;
        const recipientId = sanitizeInt(withdrawRecipientIdInput.value);
        const amount = sanitizeFloat(withdrawAmountInput.value);
        const senderId = currentUser.id;
        const senderBalance = userBalances[selectedSymbol] || 0;

        // Final Validation
        if (!selectedSymbol || amount <= 0 || !recipientId || amount > senderBalance || recipientId === senderId) {
            showTgAlert("Invalid send parameters or insufficient funds.", "Send Error");
            validateSendInput(); // Re-run validation
            return;
        }

        showLoading("Processing Transfer...");
        sendButton.disabled = true;
        withdrawStatus.textContent = 'Processing...';
        withdrawStatus.className = 'status-message pending';

        // --- Simulate Recipient Lookup (INSECURE CLIENT-SIDE) ---
        // SECURITY WARNING: This check should happen on a backend.
        const recipientRef = db.ref(`users/${recipientId}`);
        let recipientExists = false;
        try {
            const recipientSnapshot = await recipientRef.child('profile/telegram_id').once('value'); // Check if profile/ID exists
            if (recipientSnapshot.exists() && recipientSnapshot.val() === recipientId) {
                 recipientExists = true;
            }
        } catch (error) {
             console.error("Error checking recipient:", error);
             // Continue cautiously, backend must verify anyway
        }

        if (!recipientExists) {
            hideLoading();
             withdrawStatus.textContent = 'Recipient Chat ID not found in AB Wallet.';
             withdrawStatus.className = 'status-message error';
             sendButton.disabled = false; // Re-enable
             return;
        }
        // --- End Simulated Lookup ---


        const newSenderBalance = senderBalance - amount;
        // We need the recipient's current balance - this requires another read (or trust the listener, risky)
        // For an atomic update, Firebase Functions (backend) is the way.
        // SIMULATING here with potentially stale data if listener hasn't updated.
        // **BETTER**: Use Firebase Transaction on the backend.
        // **Client-side simulation (less safe):** Read recipient balance just before writing.
        let recipientBalance = 0;
        try {
             const recipBalanceSnapshot = await recipientRef.child(`balances/${selectedSymbol}`).once('value');
             recipientBalance = sanitizeFloat(recipBalanceSnapshot.val());
        } catch(e) { console.warn("Could not read recipient balance accurately for update", e); }

        const newRecipientBalance = recipientBalance + amount;

        // --- Prepare Atomic Update (INSECURE CLIENT-SIDE EXECUTION) ---
        const updates = {};
        const senderBalancePath = `/users/${senderId}/balances/${selectedSymbol}`;
        const recipientBalancePath = `/users/${recipientId}/balances/${selectedSymbol}`;
        updates[senderBalancePath] = sanitizeFloat(newSenderBalance.toFixed(8));
        updates[recipientBalancePath] = sanitizeFloat(newRecipientBalance.toFixed(8));

        // Log transaction for both sender and receiver
        const txId = db.ref().push().key; // Generate unique ID once
        const timestamp = firebase.database.ServerValue.TIMESTAMP;

        const senderTx = { type: 'send', token: selectedSymbol, amount, recipientId, timestamp, status: 'completed' };
        const receiverTx = { type: 'receive', token: selectedSymbol, amount, senderId, timestamp, status: 'completed' };

        updates[`/transactions/${senderId}/${txId}`] = senderTx;
        updates[`/transactions/${recipientId}/${txId}`] = receiverTx;
        // --- End Update Preparation ---

        try {
             // **SECURITY FLAW:** Client executing multi-user balance changes. Requires backend.
            await db.ref().update(updates);

            console.log("Internal transfer successful (simulated).");
            withdrawStatus.textContent = 'Funds Sent Successfully!';
            withdrawStatus.className = 'status-message success';
            withdrawAmountInput.value = ''; // Clear inputs
            withdrawRecipientIdInput.value = '';
            setTimeout(() => { withdrawStatus.textContent = ''; }, 3000);

        } catch (error) {
            handleFirebaseError(error, "executing internal transfer");
            withdrawStatus.textContent = 'Send Failed. Please try again.';
            withdrawStatus.className = 'status-message error';
             // NOTE: A failed atomic update might leave partial changes if not structured perfectly (another reason for backend/transactions)
        } finally {
            hideLoading();
            // Balances will update via listener, re-validating button state
            // validateSendInput(); // Let listener handle UI update then validate
        }
    }

    /** Sets up the Send Funds page (formerly Withdraw) */
    function setupSendPage() {
         updateWithdrawAssetSelector();
         withdrawAmountInput.value = '';
         withdrawRecipientIdInput.value = ''; // Clear recipient ID
         withdrawStatus.textContent = '';
         withdrawStatus.className = 'status-message';
         updateWithdrawPageBalance();
         validateSendInput(); // Initial validation
    }

    // --- Event Listeners ---
    // ... (Nav, Back, Refresh, Swap page listeners remain mostly the same) ...

    // Update Send/Withdraw Page Listeners
    if (withdrawAssetSelect) withdrawAssetSelect.addEventListener('change', updateWithdrawPageBalance);
    if (withdrawAmountInput) withdrawAmountInput.addEventListener('input', validateSendInput);
    if (withdrawRecipientIdInput) withdrawRecipientIdInput.addEventListener('input', validateSendInput); // Changed ID
    if (withdrawMaxButton) withdrawMaxButton.addEventListener('click', () => { /* ... same max logic ... */ validateSendInput(); });
    if (sendButton) sendButton.addEventListener('click', handleSend); // Changed ID

    // --- Initialization ---
    function startApp() {
        console.log("DOM Loaded. Initializing AB Wallet Pro+...");
        // ... (tg.ready, tg.expand, theme apply) ...

        if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
            currentUser = tg.initDataUnsafe.user;
            displayUserInfo();
            initializeFirebaseAndUser();
        } else { /* ... handle no user error ... */ }
        showPage('home-page');
    }
    startApp();

}); // End DOMContentLoaded
