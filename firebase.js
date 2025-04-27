// --- Firebase Configuration ---
// Make sure this matches your project details
const firebaseConfig = {
  apiKey: "AIzaSyBW1WPXUN8DYhT6npZQYoQ3l4J-jFSbzfg", // Replace if needed, but secure via Rules!
  authDomain: "ab-studio-marketcap.firebaseapp.com",
  databaseURL: "https://ab-studio-marketcap-default-rtdb.firebaseio.com",
  projectId: "ab-studio-marketcap",
  storageBucket: "ab-studio-marketcap.firebasestorage.app",
  messagingSenderId: "115268088088",
  appId: "1:115268088088:web:65643a047f92bfaa66ee6d"
};

// --- DOM Elements (assuming index.html has these IDs) ---
const dataContainer = document.getElementById('data-container');
const statusMessage = document.getElementById('status-message');

// --- Firebase Initialization and Data Fetching ---
try {
    // Initialize Firebase only once
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
        console.log("Firebase Initialized");
    } else {
        firebase.app(); // if already initialized, use that instance
        console.log("Firebase already initialized");
    }

    const database = firebase.database();
    // Get a reference to the ROOT of your database
    const rootRef = database.ref('/');

    if (statusMessage) {
        statusMessage.textContent = 'Connecting to Firebase and fetching data...';
    }

    // Listen for data changes at the root level
    rootRef.on('value', (snapshot) => {
        console.log("Data received/updated from Firebase root");
        if (dataContainer && statusMessage) {
            if (snapshot.exists()) {
                const allData = snapshot.val();
                // Display data as a formatted JSON string
                dataContainer.textContent = JSON.stringify(allData, null, 2); // null, 2 for pretty printing
                statusMessage.textContent = 'Data loaded successfully (Real-time updates enabled).';
                statusMessage.style.color = 'green';
            } else {
                dataContainer.textContent = ''; // Clear previous data
                statusMessage.textContent = 'No data found at the database root.';
                statusMessage.style.color = 'orange';
            }
        } else {
            console.error("HTML elements 'data-container' or 'status-message' not found.");
        }
    }, (error) => {
        // Handle errors during data fetching/listening
        console.error("Firebase Read Error:", error);
        if (statusMessage) {
            statusMessage.textContent = `Error fetching data: ${error.message}. Check console and Firebase Rules.`;
            statusMessage.style.color = 'red';
        }
        if (dataContainer) {
            dataContainer.textContent = ''; // Clear data on error
        }
    });

} catch (error) {
    // Handle errors during Firebase initialization
    console.error("Firebase Initialization Error:", error);
    if (statusMessage) {
        statusMessage.textContent = `Error initializing Firebase: ${error.message}`;
        statusMessage.style.color = 'red';
    }
    if (dataContainer) {
        dataContainer.textContent = ''; // Clear data on error
    }
}
