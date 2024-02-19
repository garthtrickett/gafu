// content.js

function injectScript(file, node) {
  var th = document.getElementsByTagName(node)[0];
  var s = document.createElement("script");
  s.setAttribute("type", "text/javascript");
  s.setAttribute("src", file);
  th.appendChild(s);
}

window.onload = function () {
  injectScript(chrome.runtime.getURL("get_next_props.js"), "body");
  // Function to get grammar_point_japanese

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

    window.scrollTo(0, document.body.scrollHeight);

    // Add an event listener to the button
    button.addEventListener("click", function () {
      var event = new Event("postMessageEvent");
      window.dispatchEvent(event);
      // Scroll to the bottom of the page

      window.addEventListener(
        "message",
        function (event) {
          // We only accept messages from ourselves
          if (event.source != window) return;

          if (event.data.type && event.data.type == "FROM_PAGE") {
            console.log("Content script received: ", event.data.text);
            // You can send the received message to the background script here
            let data = event.data.text;
            let slug = data.reviewable.slug;
            let id = String(data.reviewable.id);
            let meaning = data.reviewable.meaning;
            let caution = data.reviewable.caution
              ? data.reviewable.caution
              : "";
            let structure = data.reviewable.structure;
            if (!structure) {
              structure = data.reviewable.casual_structure;
              if (!structure) {
                structure = data.reviewable.polite_structure;
              }
            }

            let exampleSentences = data.included.exampleSentences;

            console.log(exampleSentences);

            let parser = new DOMParser();

            for (let i = exampleSentences.length - 1; i >= 0; i--) {
              // Parse the HTML content
              let doc = parser.parseFromString(
                exampleSentences[i].content,
                "text/html",
              );

              // Extract the Japanese text
              let japaneseText = doc.body.textContent;

              // Remove text within parentheses
              japaneseText = japaneseText.replace(/（[^）]*）/g, "");

              // Check the character length
              if (japaneseText.length > 100) {
                // Remove the item from exampleSentences
                exampleSentences.splice(i, 1);
              }
            }

            console.log(exampleSentences);

            let furiganaRegex = /(\p{Script=Han}+)（(\p{Script=Hiragana}+)）/gu;

            let japaneseSentences = {};
            let translationSentences = {};
            let audioSentences = {};

            for (let i = 0; i < exampleSentences.length; i++) {
              let japaneseKey = `japanese_sentence_${i + 1}`;
              let translationKey = `translation_sentence_${i + 1}`;
              let audioKey = `audio_sentence_${i + 1}`;
              japaneseSentences[japaneseKey] = exampleSentences[
                i
              ].content.replace(furiganaRegex, " $1[$2]");
              translationSentences[translationKey] =
                exampleSentences[i].translation;

              audioSentences[audioKey] =
                "[sound:" + exampleSentences[i].male_audio_url + "]";
            }

            let payload = {
              action: "addNote",
              note: {
                deckName: "Bunpro",
                modelName: "Bunpro",
                fields: {
                  slug,
                  id,
                  meaning,
                  caution,
                  structure,
                  ...japaneseSentences,
                  ...translationSentences,
                  ...audioSentences,
                },
                options: {
                  allowDuplicate: false,
                },
                tags: [], // add any tags if needed
              },
            };
            console.log(payload);
            let result = chrome.runtime.sendMessage(payload);

            console.log("message sent to anki", result);
          }
        },
        false,
      );
    });

    // Append the button to the ul
    ul.appendChild(button);
  } else {
    console.log("Element with specified XPath not found");
  }
};
