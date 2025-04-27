document.addEventListener("DOMContentLoaded", () => {
    // Create the iframe dynamically
    const iframe = document.createElement('iframe');
    
    // Set its properties to make it fullscreen
    iframe.src = "https://abcoinseo.github.io/Abwalletmain/";
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "none"; // Remove iframe border
    
    // Append the iframe to the body of the document
    document.body.appendChild(iframe);
});
