// background.js
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  console.log("note", request.note);
  if (request.action === "addNote") {
    fetch("http://localhost:8765", {
      method: "POST",
      body: JSON.stringify({
        action: "addNote",
        version: 6,
        params: {
          note: request.note,
        },
      }),
      headers: { "Content-Type": "application/json" },
    })
      .then((response) => response.json())
      .then((data) => console.log(data))
      .catch((error) => console.error("Error:", error));
  }
});
