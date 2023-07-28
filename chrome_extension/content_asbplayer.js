// content_asbplayer.js

// Function to update the span content
function updateSpanContent(sub_num) {
  // Select the span and change its content
  let iframe = document.querySelector("iframe");

  var jss5_div = iframe.contentDocument.querySelector(
    "html > body > #root > div:first-child > .jss2 > .jss5",
  );

  console.log(jss5_div);
  // Options for the observer (which mutations to observe)
  let config = { childList: true };

  // Callback function to execute when mutations are observed
  let callback = function (mutationsList, observer) {
    let span = jss5_div.querySelector("span");
    if (span) {
      span.textContent = sub_num;
    }

    // ADD code here to change the contents of a child span to sub_num
  };

  // Create an observer instance linked to the callback function
  let observer = new MutationObserver(callback);

  // Start observing the target node for configured mutations
  observer.observe(jss5_div, config);
}

// Function to start observing
function startObserving(targetNode) {
  // Options for the observer (which mutations to observe)
  let config = { attributes: true, childList: true, subtree: true };
  console.log("got to here");

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
      sub_num = selectedIndex;
      console.log(sub_num);
      updateSpanContent(sub_num);
    }
  };

  // Create an observer instance linked to the callback function
  let observer = new MutationObserver(callback);

  // Start observing the target node for configured mutations
  observer.observe(targetNode, config);
}

// Function to wait for the target node
function waitForNode() {
  let targetNode = document.querySelector(".MuiTableBody-root");
  if (targetNode) {
    startObserving(targetNode);
  } else {
    // If the node isn't available yet, wait for 500ms and try again
    console.log("waiting");
    setTimeout(waitForNode, 500);
  }
}

// Start the process
waitForNode();
