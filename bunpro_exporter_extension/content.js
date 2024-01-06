// content.js
window.onload = function () {
  // Function to get grammar_point_japanese
  function getGrammarPointJapanese() {
    let discussionDiv = document.getElementById("discussion");
    if (discussionDiv) {
      let h3 = discussionDiv.querySelector("h3");
      if (h3) {
        // Get everything before the "–"
        let text = h3.textContent;
        let index = text.indexOf("–");
        if (index !== -1) {
          return text.substring(0, index).trim();
        } else {
          return text;
        }
      } else {
        console.log('h3 element not found in div with id "discussion"');
      }
    } else {
      console.log('Element with id "discussion" not found');
    }
    return null;
  }

  // Function to get grammar_point_translation
  function getGrammarPointTranslation() {
    let xpathResult = document.evaluate(
      "/html/body/div/div/main/article/header/div/div[2]/div/div/h2",
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    );
    let h2 = xpathResult.singleNodeValue;
    if (h2) {
      return h2.textContent;
    } else {
      console.log("Element with specified XPath not found");
    }
    return null;
  }

  // Select the ul using XPath
  let xpathResult = document.evaluate(
    "/html/body/div/div/main/article/header/div/div[1]/div[2]/ul",
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null,
  );
  let ul = xpathResult.singleNodeValue;

  if (ul) {
    // Create a new button
    let button = document.createElement("button");
    button.textContent = "Run Script";

    // Add an event listener to the button
    button.addEventListener("click", function () {
      // Scroll to the bottom of the page
      window.scrollTo(0, document.body.scrollHeight);

      // Wait for a short delay to allow the page to render
      setTimeout(function () {
        let grammar_point_japanese = getGrammarPointJapanese();
        let grammar_point_translation = getGrammarPointTranslation();

        // Concatenate grammar_point_japanese and grammar_point_translation
        if (grammar_point_japanese && grammar_point_translation) {
          let grammar_point =
            grammar_point_japanese + " - " + grammar_point_translation;
          console.log(grammar_point);
        }

        let exampleSentences = document.querySelectorAll(
          'li[id^="example-sentence-"]',
        );
        exampleSentences.forEach(function (li) {
          let ps = li.querySelectorAll("p");

          console.log(ps[0].outerText);
          console.log(ps[1].innerHTML);
        });

        chrome.runtime.sendMessage({
          action: "addNote",
          note: {
            deckName: "Structure",
            modelName: "Universal", // replace with your model name if it's not "Basic"
            fields: {
              Morph: "helloworld",
              MorphFurigana: "helloworld",
              MorphEnglish: "helloworld",
            },
            options: {
              allowDuplicate: false,
            },
            tags: [], // add any tags if needed
          },
        });

        console.log("last thing in script");
      }, 500); // Adjust this delay as needed
    });

    // Append the button to the ul
    ul.appendChild(button);
  } else {
    console.log("Element with specified XPath not found");
  }
};
