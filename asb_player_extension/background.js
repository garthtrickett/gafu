chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    if (tab.url.includes("https://animebook.github.io/#")) {
      console.log("We are on the page");
      callAPI();
    }
  }
});

function callAPI() {
  fetch("http://localhost:8000/append", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input_string: "Hello, Animebook!" }),
  })
    .then((response) => response.json())
    .then((data) => console.log("Appended string:", data.appended_string))
    .catch((error) => console.error("Error:", error));
}
