function findSpacesTabsIndices(text) {
  let indices = [];
  for (let i = 0; i < text.length; i++) {
    if ([" ", "\t", "　", "\n", "？", "！"].includes(text[i])) {
      indices.push(i);
    }
  }
  return indices;
}

// Function to update the span content
function updateSpanContent(sub_num, lines, japanese) {
  // Select the span and change its content
  let iframe = document.querySelector("iframe");

  var jss5_div = iframe.contentDocument.querySelector(
    "html > body > #root > div:first-child > .jss2 > .jss5",
  );

  // Get all immediate child span elements of jss5_div
  let childSpans = jss5_div.querySelectorAll(":scope > span");

  // Loop through each child span and remove it from the DOM
  childSpans.forEach((span) => {
    jss5_div.removeChild(span);
  });

  indices = findSpacesTabsIndices(japanese);

  // Define a function that returns a Promise that resolves with the span element when it's found
  function findSpan() {
    return new Promise((resolve, reject) => {
      // Define a function to check if a child has been added to the jss5_div element
      function checkChildAdded() {
        let span = jss5_div.querySelector("span");
        if (span) {
          // a child has been added, resolve the Promise with the span element
          resolve(span);

          // stop checking
          clearInterval(intervalId);
        }
      }

      // Call the checkChildAdded function at a specified interval (e.g. every 100ms)
      let intervalId = setInterval(checkChildAdded, 1);
    });
  }

  // Use the findSpan function to get the span element when it's found
  findSpan().then((span) => {
    // Calculate the indices of the lines to display

    console.log(sub_num);
    // Because there is english subs now need to take one off sub_num
    // if (sub_num > 0) {
    //   sub_num = sub_num / 2;
    // }

    // Extract the lines and store them in separate variables

    let japanese = lines[sub_num];

    console.log(sub_num);
    console.log(japanese);

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
    joined_furigana = furiganaValues.join(" ");
    // create a clone of the span
    // Create a new span element
    let ichiran_span = document.createElement("span");

    ichiran_span.innerHTML = joined_furigana;
    // Get the computed style of old_span
    let sub_styling = window.getComputedStyle(span);

    // Apply each style of old_span to span
    for (let property of sub_styling) {
      ichiran_span.style[property] = sub_styling.getPropertyValue(property);
    }

    // Append the span to jss5_div
    jss5_div.appendChild(ichiran_span);

    jss5_div.firstChild.style.display = "none";
  });
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
