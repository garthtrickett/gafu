// content_asbplayer.js

// Create the floating box element
let floatingBox = document.createElement("div");
floatingBox.id = "floating-box";
floatingBox.style.position = "absolute";
floatingBox.style.display = "none";
floatingBox.style.backgroundColor = "white";
floatingBox.style.border = "1px solid black";
floatingBox.style.padding = "10px";
floatingBox.style.color = "black"; // Set the text color to black
// Add an event listener to the document object
document.addEventListener("keydown", (event) => {
  // Check if the Escape key was pressed
  if (event.key === "Escape") {
    // Hide the floating box
    floatingBox.style.display = "none";
  }
});

// Add the floating box element to the page
document.body.appendChild(floatingBox);

let style = document.createElement("style");

style.textContent = `
.token {
  position: relative;
  cursor: pointer;
}

.token:hover::after {
  all: initial;    
  content: attr(data-tooltip);
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px;
  border: 1px solid #333;
  background-color: #fff;
  font-size: 20px; /* Adjust the font size here */
  width: 200px;
  height: 100px;
  white-space: pre-wrap; /* This will allow the tooltip text to wrap */
}

rt {
  font-size: 50%; /* This will make the furigana smaller */
}
`;

document.head.appendChild(style);

// Function to update the span content
function updateSpanContent(sub_num, lines, japanese) {
  // Select the span and change its content
  let iframe = document.querySelector("iframe");

  var jss5_div = iframe.contentDocument.querySelector(
    "html > body > #root > div:first-child > .jss2 > .jss5",
  );

  // Options for the observer (which mutations to observe)
  let config = { childList: true };

  let indices = [];
  let index = japanese.indexOf(" ");
  while (index != -1) {
    indices.push(index);
    index = japanese.indexOf(" ", index + 1);
  }

  // Callback function to execute when mutations are observed
  let callback = function (mutationsList, observer) {
    let span = jss5_div.querySelector("span");
    if (span) {
      // Calculate the indices of the lines to display
      let start = sub_num * 2;
      let end = start + 2;
      // Extract the lines and store them in separate variables
      let [japanese, meaning] = lines.slice(start, end);
      let meaning_array = meaning.split("||");

      // Split the japanese variable into an array of values
      japanese = japanese.replace(/"/g, "");
      let values = japanese.split("; ");
      // Apply the regular expression replacement to each value
      let token_position = 0;
      let furiganaValues = values.map((value) => {
        let furiganaValue = value.replace(
          /(\S+)\[(.+?)\]/g,
          "<ruby><rb>$1</rb><rt>$2</rt></ruby>",
        );

        let token_num = token_position;
        token_position += 1;
        return `<span class='token-${token_num}'>${furiganaValue}</span>`;
      });

      const parser = new DOMParser();
      const doc = parser.parseFromString(furiganaValues, "text/html");
      const spans = doc.querySelectorAll("span");

      let charCount = 0;
      console.log(indices);

      let span_num = 0;
      let span_indices = [];
      for (let span of spans) {
        const rt = span.querySelector("rt");
        let textContent = span.textContent;
        if (rt) {
          textContent = textContent.replace(rt.textContent, "");
        }

        textContent = textContent.replace(" ", "");
        charCount += textContent.length;
        console.log(textContent);
        console.log(textContent.length);
        console.log(charCount);

        if (indices.includes(charCount)) {
          span_indices.push(span_num);
          charCount = charCount + 1;
        }
        span_num = span_num + 1;
      }

      for (let i = span_indices.length - 1; i >= 0; i--) {
        furiganaValues.splice(span_indices[i] + 1, 0, "<br>");
      }

      // Join the resulting array of strings and update the content of the span element
      span.innerHTML = furiganaValues.join(" ");

      span.querySelectorAll("[class^='token-']").forEach((tokenSpan) => {
        tokenSpan.addEventListener("mouseover", (event) => {
          // Add your code here to be triggered when the token span is hovered over
          console.log("Token span hovered over:", tokenSpan.textContent);
          let tokenNumber = tokenSpan.className.match(/token-(\d+)/)[1];
          console.log("Token number:", tokenNumber);
          console.log(meaning_array[tokenNumber]);

          // Replace all occurrences of "NEWLINE" with an HTML line break element
          let meaning = meaning_array[tokenNumber].replace(/NEWLINE/g, "<br>");
          meaning = meaning.replace(/《[^》]*》/g, "");

          // Update the content of the floating box
          floatingBox.innerHTML = meaning;

          // Update the position of the floating box
          let rect = tokenSpan.getBoundingClientRect();
          floatingBox.style.left = rect.left - 50 + "px";
          floatingBox.style.top =
            rect.top - floatingBox.offsetHeight - 10 + "px"; // Subtract a value from the top property
          // Show the floating box
          floatingBox.style.display = "block";
        });
      });
    }
  };

  // Create an observer instance linked to the callback function
  let observer = new MutationObserver(callback);

  // Start observing the target node for configured mutations
  observer.observe(jss5_div, config);
}

// Function to start observing
function startObserving(targetNode, lines) {
  // Options for the observer (which mutations to observe)
  let config = { attributes: true, childList: true, subtree: true };

  var sub_num = 1;

  // Callback function to execute when mutations are observed
  let callback = function (mutationsList, observer) {
    // Get the parent node
    let parentNode = document.querySelector(".MuiTableBody-root");

    // Get all the child nodes
    let childNodes = Array.from(parentNode.querySelectorAll("tr"));

    // Find the index of the child with the class 'Mui-selected'
    let selectedIndex = childNodes.findIndex((child) =>
      child.classList.contains("Mui-selected"),
    );

    // If a selected child is found, update the sub_num and the span content
    if (selectedIndex !== -1) {
      // Get the selected <tr> element
      let selectedTr = childNodes[selectedIndex];

      // Get the <span> element inside the selected <tr>
      let span = selectedTr.querySelector("td > span");

      // Get the content of the <span> element
      let japanese = span.textContent;

      sub_num = selectedIndex;
      updateSpanContent(sub_num, lines, japanese);
    }
  };

  // Create an observer instance linked to the callback function
  let observer = new MutationObserver(callback);

  // Start observing the target node for configured mutations
  observer.observe(targetNode, config);
}

// Function to wait for the target node
function waitForNode(lines) {
  let targetNode = document.querySelector(".MuiTableBody-root");
  if (targetNode) {
    startObserving(targetNode, lines); // Pass the lines array here
  } else {
    // If the node isn't available yet, wait for 500ms and try again
    setTimeout(() => waitForNode(lines), 500); // Pass the lines array here
  }
}

const targetDiv = document.querySelector(
  ".MuiToolbar-root.MuiToolbar-regular.MuiToolbar-gutters",
);
const uploadButton = document.createElement("button");
uploadButton.innerHTML = "Upload";
targetDiv.appendChild(uploadButton);

const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = ".txt";
fileInput.style.display = "none";
document.body.appendChild(fileInput);

uploadButton.addEventListener("click", () => {
  fileInput.click();
});

// Start the process
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  const reader = new FileReader();
  reader.onload = () => {
    const lines = reader.result.split("\n");
    waitForNode(lines);
  };
  reader.readAsText(file);
});
