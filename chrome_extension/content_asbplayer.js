// content_asbplayer.js
/*
 * Copyright (C) 2023  Yomitan Authors
 * Copyright (C) 2020-2022  Yomichan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * This class is used to control the document focus when a non-body element contains the main scrollbar.
 * Web browsers will not automatically focus a custom element with the scrollbar on load, which results in
 * keyboard shortcuts (e.g. arrow keys) not controlling page scroll. Instead, this class will manually
 * focus a dummy element inside the main content, which gives keyboard scroll focus to that element.
 */
class DocumentFocusController {
  /**
   * Creates a new instance of the class.
   * @param {?string} autofocusElementSelector A selector string which can be used to specify an element which
   *   should be automatically focused on prepare.
   */
  constructor(autofocusElementSelector = null) {
    this._autofocusElement =
      autofocusElementSelector !== null
        ? document.querySelector(autofocusElementSelector)
        : null;
    this._contentScrollFocusElement = document.querySelector(
      "#content-scroll-focus",
    );
  }

  /**
   * Initializes the instance.
   */
  prepare() {
    window.addEventListener("focus", this._onWindowFocus.bind(this), false);
    this._updateFocusedElement(false);
    if (
      this._autofocusElement !== null &&
      document.activeElement !== this._autofocusElement
    ) {
      this._autofocusElement.focus({ preventScroll: true });
    }
  }

  /**
   * Removes focus from a given element.
   * @param {Element} element The element to remove focus from.
   */
  blurElement(element) {
    if (document.activeElement !== element) {
      return;
    }
    element.blur();
    this._updateFocusedElement(false);
  }

  // Private

  _onWindowFocus() {
    this._updateFocusedElement(false);
  }

  _updateFocusedElement(force) {
    const target = this._contentScrollFocusElement;
    if (target === null) {
      return;
    }

    const { activeElement } = document;
    if (
      force ||
      activeElement === null ||
      activeElement === document.documentElement ||
      activeElement === document.body
    ) {
      // Get selection
      const selection = window.getSelection();
      const selectionRanges1 = this._getSelectionRanges(selection);

      // Note: This function will cause any selected text to be deselected on Firefox.
      target.focus({ preventScroll: true });

      // Restore selection
      const selectionRanges2 = this._getSelectionRanges(selection);
      if (!this._areRangesSame(selectionRanges1, selectionRanges2)) {
        this._setSelectionRanges(selection, selectionRanges1);
      }
    }
  }

  _getSelectionRanges(selection) {
    const ranges = [];
    for (let i = 0, ii = selection.rangeCount; i < ii; ++i) {
      ranges.push(selection.getRangeAt(i));
    }
    return ranges;
  }

  _setSelectionRanges(selection, ranges) {
    selection.removeAllRanges();
    for (const range of ranges) {
      selection.addRange(range);
    }
  }

  _areRangesSame(ranges1, ranges2) {
    const ii = ranges1.length;
    if (ii !== ranges2.length) {
      return false;
    }

    for (let i = 0; i < ii; ++i) {
      const range1 = ranges1[i];
      const range2 = ranges2[i];
      try {
        if (
          range1.compareBoundaryPoints(Range.START_TO_START, range2) !== 0 ||
          range1.compareBoundaryPoints(Range.END_TO_END, range2) !== 0
        ) {
          return false;
        }
      } catch (e) {
        return false;
      }
    }

    return true;
  }
}

// START GAFU CODE

// Create the floating box element
let floatingBox = document.createElement("div");
floatingBox.id = "floating-box";
floatingBox.style.position = "absolute";
floatingBox.style.display = "none";
floatingBox.style.backgroundColor = "white";
floatingBox.style.border = "1px solid black";
floatingBox.style.padding = "10px";
floatingBox.style.color = "black"; // Set the text color to black

// Add the floating box element to the page

// Create a new div element
let translationBox = document.createElement("div");
// Set the ID of the div element
translationBox.id = "translation-box";
// Set the CSS styles of the div element
translationBox.style.display = "none";
translationBox.style.position = "absolute";
translationBox.style.border = "1px solid black";
translationBox.style.backgroundColor = "white";
translationBox.style.padding = "10px";
translationBox.style.color = "black"; // Set the text color to black
// Append the div element to the body

// Create a new div element with id gafu
let gafuDiv = document.createElement("div");
gafuDiv.id = "gafu";

// Append the floating box and translation box elements to the gafu div
gafuDiv.appendChild(floatingBox);
gafuDiv.appendChild(translationBox);

// Append the gafu div to the body
document.body.appendChild(gafuDiv);

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

    let start = sub_num * 3;
    let end = start + 3;
    // Extract the lines and store them in separate variables
    let [japanese, meaning, translation] = lines.slice(start, end);

    let translationBox = document.querySelector("#translation-box");
    translationBox.textContent = translation;

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

    let clone = span.cloneNode(true);
    span.parentNode.insertBefore(clone, span.nextSibling);
    clone.innerHTML = joined_furigana;
    clone.id = "ichiran_subtitles";

    let sibling = span.nextSibling;
    while (sibling) {
      let nextSibling = sibling.nextSibling;
      if (sibling !== clone) {
        sibling.remove();
      }
      sibling = nextSibling;
    }

    let rect = clone.getBoundingClientRect();
    translationBox.style.left = rect.left + 150 + "px";
    translationBox.style.top = rect.top - floatingBox.offsetHeight - 150 + "px"; // Subtract a value from the top property

    clone.querySelectorAll("[class^='token-']").forEach((tokenSpan) => {
      tokenSpan.addEventListener("mouseover", (event) => {
        // Add your code here to be triggered when the token span is hovered over
        let tokenNumber = tokenSpan.className.match(/token-(\d+)/)[1];

        const documentFocusController = new DocumentFocusController(
          "#floating-box",
        );
        documentFocusController.prepare();

        // Replace all occurrences of "NEWLINE" with an HTML line break element
        let meaning = meaning_array[tokenNumber].replace(/NEWLINE/g, "<br>");
        meaning = meaning.replace(/《[^》]*》/g, "");

        // Update the content of the floating box
        floatingBox.innerHTML = meaning;

        // Update the position of the floating box
        let rect = tokenSpan.getBoundingClientRect();
        floatingBox.style.left = rect.left - 50 + "px";
        floatingBox.style.top =
          rect.top - floatingBox.offsetHeight - 100 + "px"; // Subtract a value from the top property
        // Show the floating box
        floatingBox.style.display = "block";
      });
      floatingBox.setAttribute("tabindex", "0");
    });
    // Use the span element here
    console.log(span);
  });
}

// Function to start observing
function startObserving(targetNode, lines) {
  // Options for the observer (which mutations to observe)
  let config = { attributes: true, childList: true, subtree: true };

  var sub_num = 1;

  // Callback function to execute when mutations are observed
  let callback = function (mutationsList, observer) {
    translationBox.style.display = "none";

    floatingBox.style.display = "none";
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

  let iframe = document.querySelector("iframe");

  var jss5_div = iframe.contentDocument.querySelector(
    "html > body > #root > div:first-child > .jss2 > .jss5",
  );

  let observer_two = new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      if (mutation.type === "childList") {
        let spanElements = jss5_div.querySelectorAll("span");
        if (spanElements.length > 1) {
          spanElements[0].style.display = "none";
        }
        spanElements[1].style.display = "block";
      }
    });
  });

  let config_two = { childList: true, subtree: true };
  observer_two.observe(jss5_div, config_two);
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
  let iframe = document.querySelector("iframe.jss49");
  let video = iframe.contentWindow.document.querySelector("video");

  // Add an event listener for the play event
  video.addEventListener("play", (event) => {
    // Hide the floating box
    floatingBox.style.display = "none";
  });
});

document.addEventListener(
  "keydown",
  (event) => {
    // Check if the Escape key was pressed
    if (
      event.key === "Escape" ||
      event.key === "ArrowRight" ||
      event.key === "ArrowLeft"
    ) {
      // Hide the floating box
      floatingBox.style.display = "none";
      translationBox.style.display = "none";
    }
  },
  { capture: true },
);

document.addEventListener("keydown", function (event) {
  if (event.key === "w") {
    const documentFocusController = new DocumentFocusController(
      "#translation-box",
    );
    documentFocusController.prepare();

    console.log("KEYDOWN");
    // Update the content of the div element
    // Show the div element
    let translationBox = document.querySelector("#translation-box");
    translationBox.style.display = "block";
  }
});
