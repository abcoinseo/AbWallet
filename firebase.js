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
    let userBalances = {}; // Store balances as { 'USD': 100, 'ABT': 50 }
    let availableTokens = {}; // Store token info { 'ABT': { name: 'AB Token', priceUSD: 0.5, logoUrl: '...' } }
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
    const withdrawRecipientIdInput = document.getElementById('withdraw-recipient-id'); // Input for Chat ID
    const withdrawAmountInput = document.getElementById('withdraw-amount');
    const sendButton = document.getElementById('send-button'); // Send button
    const withdrawMaxButton = document.getElementById('withdraw-max-button');
    const withdrawStatus = document.getElementById('withdraw-status'); // Status message element
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
         return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: decimals });
    };
    const sanitizeFloat = (value) => parseFloat(value) || 0;
    const sanitizeInt = (value) => parseInt(value, 10) || 0;


    // --- Loading & Alerts ---
    function showLoading(message = "Loading...") {
        if(!loadingOverlay) return;
        loadingOverlay.querySelector('p').textContent = message;
        loadingOverlay.classList.add('visible');
    }
    function hideLoading() {
        if(loadingOverlay) loadingOverlay.classList.remove('visible');
    }
    function showTgAlert(message, title = 'Info') {
        if (tg && typeof tg.showAlert === 'function') {
            tg.showAlert(`${title}: ${message}`);
        } else {
            alert(`${title}: ${message}`); // Fallback
            console.warn("Telegram WebApp context not fully available for alert.");
        }
    }
    function handleFirebaseError(error, context = "Firebase operation") {
        console.error(`${context} Error:`, error);
        hideLoading();
        let message = `Error: ${error.message || 'Unknown error'}. Code: ${error.code || 'N/A'}`;
        if (error.code === 'PERMISSION_DENIED') {
             message = "Error: Permission denied. Check Firebase rules.";
         }
        showTgAlert(message, context);
    }


    // --- Navigation & Page Handling ---
    function showPage(pageId) {
        let pageFound = false;
        pages.forEach(page => {
             const isActive = page.id === pageId;
             page.classList.toggle('active', isActive);
             if(isActive) pageFound = true;
        });
        if (!pageFound) { console.error(`Page "${pageId}" not found.`); pageId = 'home-page'; pages[0]?.classList.add('active'); } // Default to home

        navButtons.forEach(button => {
            button.classList.toggle('active', button.dataset.page === pageId);
        });
        document.getElementById('main-content').scrollTop = 0; // Reset scroll

        // Page specific setup/reset
        if (pageId === 'home-page') updateHomePageUI();
        if (pageId === 'withdraw-page') setupSendPage(); // Use new setup function name
        if (pageId === 'deposit-page') setupReceivePage(); // Use new setup function name
        if (pageId === 'swap-page') setupSwapPage();
    }


    // --- Core Data Handling & UI Updates ---
    /** Fetches token definitions from Firebase */
    async function fetchAvailableTokens() {
        if (!db) return;
        try {
            const snapshot = await db.ref('tokens').once('value');
            availableTokens = snapshot.val() || {};
            console.log("Available tokens fetched:", Object.keys(availableTokens));
             // Initial population after tokens are loaded
             populateTokenSelectors(); // For Swap page
             updateWithdrawAssetSelector(); // For Send page
        } catch (error) {
            handleFirebaseError(error, "fetching token list");
        }
    }

     /** Updates the main portfolio display on the Home page */
     function updateHomePageUI() {
         if (!assetListContainer || !totalBalanceDisplay) return;
         let totalValueUSD = 0;
         assetListContainer.innerHTML = ''; // Clear existing list

         const sortedSymbols = Object.keys(userBalances)
            .filter(symbol => userBalances[symbol] > 0.000001 && availableTokens[symbol]) // Only show if token exists
            .sort((a, b) => {
                const valueA = (userBalances[a] || 0) * (availableTokens[a]?.priceUSD || 0);
                const valueB = (userBalances[b] || 0) * (availableTokens[b]?.priceUSD || 0);
                return valueB - valueA;
            });

         if (sortedSymbols.length === 0) {
             assetListContainer.innerHTML = '<p class="no-assets">You have no assets yet.</p>';
         } else {
             sortedSymbols.forEach(symbol => {
                 const balance = userBalances[symbol] || 0;
                 const tokenInfo = availableTokens[symbol]; // Already checked it exists
                 const priceUSD = tokenInfo.priceUSD || 0;
                 const valueUSD = balance * priceUSD;
                 totalValueUSD += valueUSD;

                 const card = document.createElement('div');
                 card.className = 'asset-card';
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
                         <div class="value-usd">≈ $${formatCurrency(valueUSD)}</div>
                     </div>
                 `;
                 assetListContainer.appendChild(card);
             });
         }
         totalBalanceDisplay.textContent = formatCurrency(totalValueUSD);
     }

    /** Displays user profile info */
    function displayUserInfo() {
        if (!userInfoDisplay || !currentUser) { /* ... handle missing element/user ... */ return; }
        const { first_name = '', last_name = '', username = null, id } = currentUser;
        const fullName = `${first_name} ${last_name}`.trim() || 'N/A';
        userInfoDisplay.innerHTML = `
            <p><strong>Name:</strong> <span>${fullName}</span></p>
            <p><strong>Username:</strong> <span>${username ? '@' + username : 'N/A'}</span></p>
            <p><strong>Chat ID:</strong> <span>${id}</span></p>
        `;
    }

    /** Sets up the RECEIVE funds page UI */
    function setupReceivePage() {
        if (depositChatIdSpan && currentUser) {
            depositChatIdSpan.textContent = currentUser.id;
            const copyBtn = depositChatIdSpan.closest('.deposit-info-card')?.querySelector('.copy-button');
            if (copyBtn) copyBtn.dataset.clipboardText = currentUser.id;
        } else if (depositChatIdSpan) {
            depositChatIdSpan.textContent = 'Not available';
        }
    }


    // --- Firebase Realtime Updates ---
    function setupBalanceListener() {
        if (!userDbRef || balanceListenerAttached) return;
        const balancesRef = userDbRef.child('balances');
        balancesRef.on('value', (snapshot) => {
            userBalances = snapshot.val() || {};
            console.log("Realtime balances update:", userBalances);
            if (document.getElementById('home-page')?.classList.contains('active')) updateHomePageUI();
            if (document.getElementById('swap-page')?.classList.contains('active')) {
                updateSwapBalancesUI();
                validateSwapInput(); // Re-check if enough balance after update
            }
            if (document.getElementById('withdraw-page')?.classList.contains('active')) {
                updateWithdrawPageBalance(); // This calls validateSendInput
            }
        }, (error) => {
            handleFirebaseError(error, "listening to balances");
            balanceListenerAttached = false;
        });
        balanceListenerAttached = true;
        console.log("Balances listener attached.");
    }


    /** Initializes Firebase and User Data */
    async function initializeFirebaseAndUser() {
        showLoading("Connecting & Loading Data...");
        try {
            if (!firebase.apps.length) { firebaseApp = firebase.initializeApp(firebaseConfig); }
            else { firebaseApp = firebase.app(); }
            db = firebase.database();
            console.log("Firebase Initialized");

            await fetchAvailableTokens(); // Load tokens first, needed for UI population

            if (!currentUser || !currentUser.id) { throw new Error("User data not available."); }

            const userId = currentUser.id.toString();
            userDbRef = db.ref('users/' + userId);

            const snapshot = await userDbRef.once('value');
            if (!snapshot.exists()) {
                console.log(`User ${userId} not found. Creating...`);
                const initialBalances = { USD: 0 }; // Start with 0 USD
                await userDbRef.set({
                    profile: { /* ... profile data ... */ },
                    balances: initialBalances
                });
                userBalances = initialBalances;
            } else {
                const userData = snapshot.val();
                userBalances = userData.balances || { USD: 0 };
                 // Update profile info silently
                 userDbRef.child('profile').update({ /* ... names, lastLogin ... */ });
            }

            setupBalanceListener(); // Attach listener AFTER initial load/create
            updateHomePageUI(); // Initial UI update for home page
            hideLoading();

        } catch (error) {
            handleFirebaseError(error, "Initialization");
            disableAppFeatures();
        }
    }

    function disableAppFeatures() {
        console.error("Disabling app features due to initialization error.");
        navButtons.forEach(b => b.disabled = true);
        // Potentially show an error message overlay
    }


    // --- Swap Functionality (with Fee) ---
    function openTokenModal(selectorType) { /* ... */ }
    function closeTokenModal() { /* ... */ }
    function populateTokenListModal(searchTerm = '') { /* ... */ }
    function handleTokenSelection(selectedSymbol) { /* ... */ }
    function updateTokenButtonUI(buttonElement, tokenSymbol) { /* ... */ }
    function updateSwapBalancesUI() { /* ... */ }
    function populateTokenSelectors() { /* ... */ }

    /** Calculates the swap rate (Rate doesn't include fee) */
    function calculateSwapRate() {
        const { fromToken, toToken } = swapState;
        swapState.rate = 0; // Reset rate
        if (!fromToken || !toToken || !availableTokens[fromToken] || !availableTokens[toToken]) {
            calculateSwapAmounts(); // Calculate amounts (will be 0) and update UI
            return;
        }
        const fromPrice = availableTokens[fromToken].priceUSD || 0;
        const toPrice = availableTokens[toToken].priceUSD || 0;
        if (fromPrice <= 0 || toPrice <= 0) {
            console.error("Cannot calculate rate due to zero price for", fromToken, "or", toToken);
             calculateSwapAmounts(); // Calculate amounts (will be 0) and update UI
             return;
        }
        swapState.rate = fromPrice / toPrice;
        calculateSwapAmounts(); // Recalculate amounts based on new rate
    }

    /** Calculates the From/To amounts INCLUDING the fee */
    function calculateSwapAmounts() {
        const { fromToken, toToken, fromAmount, rate } = swapState;
        swapState.toAmount = 0; // Reset 'to' amount
        if (!fromToken || !toToken || !fromAmount || fromAmount <= 0 || rate <= 0) {
             updateSwapUI();
             return;
        }

        let calculatedToAmount = 0;
        const feeMultiplier = SWAP_FEE_PERCENT / 100;

        if (fromToken === 'USD') { // Buying Coin (USD -> Other)
            const amountAfterFee = fromAmount * (1 - feeMultiplier);
            calculatedToAmount = amountAfterFee * rate;
        } else if (toToken === 'USD') { // Selling Coin (Other -> USD)
            calculatedToAmount = (fromAmount * rate) * (1 - feeMultiplier);
        } else { // Coin to Coin (e.g., ABT -> BTC)
            const baseToAmount = fromAmount * rate;
            calculatedToAmount = baseToAmount * (1 - feeMultiplier);
        }
        swapState.toAmount = calculatedToAmount > 0 ? calculatedToAmount : 0;
        updateSwapUI(); // Update all swap UI elements
    }

    function handleFromAmountChange() {
        swapState.fromAmount = sanitizeFloat(swapFromAmountInput.value);
        calculateSwapAmounts(); // Recalculate output and update UI
    }

    function switchSwapTokens() {
        const tempToken = swapState.fromToken;
        swapState.fromToken = swapState.toToken;
        swapState.toToken = tempToken;
        // Use the old estimated 'to' amount as the new 'from' amount for convenience
        swapState.fromAmount = swapState.toAmount; // Note: This is the *fee-adjusted* amount
        calculateSwapRate(); // Recalculate rate and then the new 'to' amount
    }

    /** Validates swap inputs and enables/disables swap button */
    function validateSwapInput() {
         const { fromToken, toToken, fromAmount, toAmount } = swapState;
         const hasSufficientBalance = (userBalances[fromToken] || 0) >= fromAmount;
         const isValid = fromToken && toToken && fromAmount > 0 && toAmount > 0 && hasSufficientBalance;
         if (executeSwapButton) executeSwapButton.disabled = !isValid;
    }

    function updateSwapUI() {
        // ... (Update token buttons, balances as before) ...
        if (swapFromAmountInput) swapFromAmountInput.value = swapState.fromAmount > 0 ? swapState.fromAmount : '';
        if (swapToAmountInput) swapToAmountInput.value = swapState.toAmount > 0 ? formatTokenAmount(swapState.toAmount, availableTokens[swapState.toToken]?.symbol === 'USD' ? 2 : 6) : '';

        if (swapRateDisplay) {
             if (swapState.rate > 0 && swapState.fromToken && swapState.toToken) {
                swapRateDisplay.textContent = `1 ${swapState.fromToken} ≈ ${formatTokenAmount(swapState.rate)} ${swapState.toToken}`;
                swapRateDisplay.classList.remove('error', 'loading');
             } else if (swapState.fromToken && swapState.toToken) {
                swapRateDisplay.textContent = 'Loading rate...';
                swapRateDisplay.classList.add('loading');
                swapRateDisplay.classList.remove('error');
             } else {
                swapRateDisplay.textContent = 'Select tokens';
                swapRateDisplay.classList.remove('error', 'loading');
             }
        }
        validateSwapInput(); // Check button state after UI updates
    }

    async function executeSwap() {
        if (!userDbRef || !currentUser || !executeSwapButton || executeSwapButton.disabled) return;

        const { fromToken, toToken, fromAmount, toAmount } = swapState;
        // Final validation before execution
        if (!fromToken || !toToken || fromAmount <= 0 || toAmount <= 0 || (userBalances[fromToken] || 0) < fromAmount) {
            showTgAlert("Invalid swap details or insufficient balance.", "Swap Error");
            return;
        }

        showLoading("Processing Swap...");
        executeSwapButton.disabled = true;
        swapStatus.textContent = 'Processing...'; swapStatus.className = 'status-message pending';

        const newFromBalance = (userBalances[fromToken] || 0) - fromAmount;
        const newToBalance = (userBalances[toToken] || 0) + toAmount;

        // ** INSECURE CLIENT-SIDE UPDATE ** Requires Backend for security
        const updates = {};
        const senderId = currentUser.id;
        updates[`/users/${senderId}/balances/${fromToken}`] = sanitizeFloat(newFromBalance.toFixed(8));
        updates[`/users/${senderId}/balances/${toToken}`] = sanitizeFloat(newToBalance.toFixed(8));

        const txData = { /* ... tx details including fee ... */ };
        const newTxKey = db.ref(`/transactions/${senderId}`).push().key;
        updates[`/transactions/${senderId}/${newTxKey}`] = txData;

        try {
            await db.ref().update(updates);
            swapStatus.textContent = 'Swap Successful!'; swapStatus.className = 'status-message success';
            setTimeout(() => { /* reset swap form, clear status */ swapState.fromAmount = 0; swapState.toAmount=0; updateSwapUI(); swapStatus.textContent=''; }, 2500);
        } catch (error) {
            handleFirebaseError(error, "executing swap");
            swapStatus.textContent = 'Swap Failed.'; swapStatus.className = 'status-message error';
            // Consider reverting optimistic UI changes or forcing refresh on error
        } finally {
            hideLoading();
            // Don't re-enable button immediately, let validation logic handle it based on updated balances
        }
    }

    function setupSwapPage() {
         // Keep selected tokens? Or reset? Let's keep them for now.
         swapState.fromAmount = 0;
         swapState.toAmount = 0;
         calculateSwapRate(); // Calculate rate for current tokens
         updateSwapUI();
         if(swapStatus) swapStatus.textContent = '';
    }


    // --- Internal Send/Withdraw Functionality ---
    function updateWithdrawAssetSelector() {
        if (!withdrawAssetSelect) return;
        const previousValue = withdrawAssetSelect.value;
        withdrawAssetSelect.innerHTML = '<option value="">-- Select Asset --</option>';
        Object.keys(availableTokens)
             .sort((a, b) => a.localeCompare(b))
             .forEach(symbol => {
                 const tokenInfo = availableTokens[symbol];
                 if (tokenInfo) {
                     const option = document.createElement('option');
                     option.value = symbol;
                     option.textContent = `${tokenInfo.name} (${symbol})`;
                     withdrawAssetSelect.appendChild(option);
                 }
             });
        // Restore selection if possible
        if (previousValue && withdrawAssetSelect.querySelector(`option[value="${previousValue}"]`)) {
             withdrawAssetSelect.value = previousValue;
         } else {
             withdrawAssetSelect.value = "";
         }
        updateWithdrawPageBalance(); // Update balance display for selected asset
    }

    function updateWithdrawPageBalance() {
        if (!withdrawAvailableBalance || !withdrawAssetSelect) return;
        const selectedSymbol = withdrawAssetSelect.value;
        const balance = userBalances[selectedSymbol] || 0;
        withdrawAvailableBalance.textContent = `${formatTokenAmount(balance, selectedSymbol === 'USD' ? 2 : 6)} ${selectedSymbol || ''}`;
        if (withdrawMaxButton) withdrawMaxButton.disabled = balance <= 0;
        validateSendInput(); // Re-validate inputs after balance update
    }

    function validateSendInput() {
        if (!sendButton || !withdrawAssetSelect || !withdrawAmountInput || !withdrawRecipientIdInput) return;

        const selectedSymbol = withdrawAssetSelect.value;
        const amount = sanitizeFloat(withdrawAmountInput.value);
        const balance = userBalances[selectedSymbol] || 0;
        const recipientIdStr = withdrawRecipientIdInput.value.trim();
        const recipientId = sanitizeInt(recipientIdStr);

        let isValid = true;
        let statusMsg = '';
        withdrawStatus.className = 'status-message'; // Reset status

        if (!selectedSymbol) isValid = false;
        else if (amount <= 0) isValid = false;
        else if (amount > balance) { isValid = false; statusMsg = 'Amount exceeds available balance.'; withdrawStatus.className = 'status-message error'; }
        else if (!recipientIdStr) isValid = false;
        else if (!/^\d+$/.test(recipientIdStr) || recipientId <= 0) { isValid = false; statusMsg = 'Invalid Recipient Chat ID.'; withdrawStatus.className = 'status-message error'; }
        else if (currentUser && recipientId === currentUser.id) { isValid = false; statusMsg = 'Cannot send to yourself.'; withdrawStatus.className = 'status-message error'; }

        sendButton.disabled = !isValid;
        withdrawStatus.textContent = statusMsg; // Display error message
    }

    async function handleSend() {
        if (!userDbRef || !currentUser || !db || !sendButton || sendButton.disabled) return;

        const selectedSymbol = withdrawAssetSelect.value;
        const recipientId = sanitizeInt(withdrawRecipientIdInput.value);
        const amount = sanitizeFloat(withdrawAmountInput.value);
        const senderId = currentUser.id;
        // Use current state balance for validation check
        if (!selectedSymbol || amount <= 0 || !recipientId || recipientId === senderId || (userBalances[selectedSymbol] || 0) < amount) {
            showTgAlert("Invalid send details or insufficient funds.", "Send Error");
            validateSendInput();
            return;
        }

        showLoading("Processing Transfer...");
        sendButton.disabled = true;
        withdrawStatus.textContent = 'Verifying recipient...'; withdrawStatus.className = 'status-message pending';

        // ** INSECURE CLIENT-SIDE RECIPIENT CHECK ** Requires Backend
        const recipientRef = db.ref(`users/${recipientId}`);
        let recipientExists = false;
        try {
            // Check if recipient has a profile (basic check)
            const recipientSnapshot = await recipientRef.child('profile').once('value');
            recipientExists = recipientSnapshot.exists();
        } catch (error) { console.error("Error checking recipient:", error); /* Handle error */ }

        if (!recipientExists) {
            hideLoading();
            withdrawStatus.textContent = 'Recipient Chat ID not found.'; withdrawStatus.className = 'status-message error';
            validateSendInput(); // Re-enable button if appropriate
            return;
        }

        withdrawStatus.textContent = 'Processing transfer...'; // Update status

        // ** INSECURE CLIENT-SIDE ATOMIC UPDATE SIMULATION ** Requires Backend with Transactions
        const updates = {};
        const senderBalancePath = `/users/${senderId}/balances/${selectedSymbol}`;
        const recipientBalancePath = `/users/${recipientId}/balances/${selectedSymbol}`;

        // Need recipient's current balance for accurate update - fetch just before write (still risky client-side)
        let recipientCurrentBalance = 0;
        try {
            const recipBalanceSnapshot = await recipientRef.child(`balances/${selectedSymbol}`).once('value');
            recipientCurrentBalance = sanitizeFloat(recipBalanceSnapshot.val());
        } catch (e) { console.warn("Could not reliably read recipient balance before update", e); }

        const newSenderBalance = (userBalances[selectedSymbol] || 0) - amount;
        const newRecipientBalance = recipientCurrentBalance + amount;

        updates[senderBalancePath] = sanitizeFloat(newSenderBalance.toFixed(8));
        updates[recipientBalancePath] = sanitizeFloat(newRecipientBalance.toFixed(8));

        // Log transaction for both parties
        const txId = db.ref(`/transactions/${senderId}`).push().key; // Use sender's node to generate key
        const timestamp = firebase.database.ServerValue.TIMESTAMP;
        const senderTx = { type: 'send', token: selectedSymbol, amount, recipientId, timestamp, status: 'completed' };
        const receiverTx = { type: 'receive', token: selectedSymbol, amount, senderId, timestamp, status: 'completed' };
        updates[`/transactions/${senderId}/${txId}`] = senderTx;
        updates[`/transactions/${recipientId}/${txId}`] = receiverTx; // Log in recipient's history too

        try {
            await db.ref().update(updates); // Attempt atomic update
            withdrawStatus.textContent = 'Funds Sent Successfully!'; withdrawStatus.className = 'status-message success';
            withdrawAmountInput.value = ''; withdrawRecipientIdInput.value = '';
            setTimeout(() => { withdrawStatus.textContent = ''; }, 3000);
        } catch (error) {
            handleFirebaseError(error, "executing internal transfer");
            withdrawStatus.textContent = 'Send Failed.'; withdrawStatus.className = 'status-message error';
        } finally {
            hideLoading();
            // Let listener update balances and re-validate button state via validateSendInput()
        }
    }

    function setupSendPage() {
         if(withdrawAssetSelect) updateWithdrawAssetSelector(); // Populate/update asset list
         if(withdrawAmountInput) withdrawAmountInput.value = '';
         if(withdrawRecipientIdInput) withdrawRecipientIdInput.value = '';
         if(withdrawStatus) { withdrawStatus.textContent = ''; withdrawStatus.className = 'status-message'; }
         updateWithdrawPageBalance(); // Update balance display
         validateSendInput(); // Set initial button state
    }

    // --- Event Listeners ---
    navButtons.forEach(button => button.addEventListener('click', () => showPage(button.dataset.page)));
    backButtons.forEach(button => button.addEventListener('click', () => showPage(button.dataset.target || 'home-page')));
    if(refreshButton) refreshButton.addEventListener('click', initializeFirebaseAndUser); // Re-fetch data

    // Swap Page
    if(swapFromAmountInput) swapFromAmountInput.addEventListener('input', handleFromAmountChange);
    if(swapSwitchButton) swapSwitchButton.addEventListener('click', switchSwapTokens);
    if(executeSwapButton) executeSwapButton.addEventListener('click', executeSwap);
    if(swapFromTokenButton) swapFromTokenButton.addEventListener('click', () => openTokenModal('from'));
    if(swapToTokenButton) swapToTokenButton.addEventListener('click', () => openTokenModal('to'));

    // Token Modal
    if (closeModalButton) closeModalButton.addEventListener('click', closeTokenModal);
    if (tokenSearchInput) tokenSearchInput.addEventListener('input', (e) => populateTokenListModal(e.target.value));
    if (tokenModal) tokenModal.addEventListener('click', (e) => { if (e.target === tokenModal) closeTokenModal(); }); // Close on outside click

    // Send Page
    if (withdrawAssetSelect) withdrawAssetSelect.addEventListener('change', updateWithdrawPageBalance);
    if (withdrawAmountInput) withdrawAmountInput.addEventListener('input', validateSendInput);
    if (withdrawRecipientIdInput) withdrawRecipientIdInput.addEventListener('input', validateSendInput);
    if (withdrawMaxButton) withdrawMaxButton.addEventListener('click', () => {
        const selectedSymbol = withdrawAssetSelect?.value;
        if (selectedSymbol && withdrawAmountInput) {
            withdrawAmountInput.value = userBalances[selectedSymbol] || 0;
             validateSendInput();
        }
    });
    if(sendButton) sendButton.addEventListener('click', handleSend);


    // --- Initialization ---
    function startApp() {
        console.log("DOM Loaded. Initializing AB Wallet Pro+...");
        tg.ready();
        tg.expand();
        // Apply theme params if needed

        // Use initDataUnsafe for display only, VALIDATE initData on backend for secure actions
        if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
            currentUser = tg.initDataUnsafe.user;
            console.log("User Data:", currentUser.id, currentUser.username);
            displayUserInfo();
            initializeFirebaseAndUser();
        } else {
            console.error("Could not retrieve Telegram user data.");
            showTgAlert("Could not load user information. Wallet functionality limited.", "Initialization Error");
            hideLoading();
            disableAppFeatures();
        }
        showPage('home-page'); // Default to home page
    }
    startApp();

}); // End DOMContentLoaded
