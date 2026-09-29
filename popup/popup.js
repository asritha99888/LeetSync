const button = document.getElementById("github-login");
const status = document.getElementById("status");

button.addEventListener("click", () => {
    status.textContent = "GitHub authentication coming soon...";
});