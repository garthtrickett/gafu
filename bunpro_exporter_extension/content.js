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
            let caution = data.reviewable.caution;
            let structure = data.reviewable.structure;
            if (!structure) {
              structure = data.reviewable.casual_structure;
              if (!structure) {
                structure = data.reviewable.polite_structure;
              }
            }
            let exampleSentences = data.included.exampleSentences;

            let furiganaRegex = /(\p{Script=Han}+)（(\p{Script=Hiragana}+)）/gu;

            let content =
              "<span class='vocab-popout' data-vocab-id='58'>お茶（ちゃ）</span><span class='gp-popout' data-gp-id='10'><strong>が</strong></span><span class='gp-popout vocab-popout' data-gp-id='24' data-vocab-id='377'>冷（つめ）たい</span><span class='gp-popout' data-gp-id='2'>です</span>。";

            let formattedContent = content.replace(furiganaRegex, " $1[$2]");

            console.log(formattedContent);

            let japaneseSentences = {};
            let translationSentences = {};

            for (let i = 0; i < exampleSentences.length; i++) {
              let japaneseKey = `japanese_sentence_${i + 1}`;
              let translationKey = `translation_sentence_${i + 1}`;
              japaneseSentences[japaneseKey] = exampleSentences[
                i
              ].content.replace(furiganaRegex, " $1[$2]");
              translationSentences[translationKey] =
                exampleSentences[i].translation;
            }
            console.log(japaneseSentences);

            chrome.runtime.sendMessage({
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
                },
                options: {
                  allowDuplicate: true,
                },
                tags: [], // add any tags if needed
              },
            });
          }
        },
        false,
      );

      console.log("last thing in script");
    });

    // Append the button to the ul
    ul.appendChild(button);
  } else {
    console.log("Element with specified XPath not found");
  }
};
