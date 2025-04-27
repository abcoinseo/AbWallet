document.addEventListener("DOMContentLoaded", function () {
    // Disable right-click on the webpage
    document.addEventListener("contextmenu", function (e) {
        e.preventDefault();
    });

    // Disable F12 key (Developer Tools)
    document.addEventListener("keydown", function (e) {
        // Disable F12 and other dev tool-related keys
        if (e.keyCode == 123 ||  // F12 key
            (e.ctrlKey && e.shiftKey && e.keyCode == 73) ||  // Ctrl + Shift + I
            (e.ctrlKey && e.keyCode == 85) ||  // Ctrl + U (View source)
            (e.ctrlKey && e.keyCode == 83)) {  // Ctrl + S (Save Page)
            e.preventDefault();
        }
    });

    // Disable the right-click and some key combinations to view page source
    window.addEventListener("keydown", function (e) {
        // Block Ctrl + U and other shortcuts
        if ((e.ctrlKey && e.keyCode == 85) || (e.ctrlKey && e.keyCode == 83)) {
            e.preventDefault();
        }
    });
});
