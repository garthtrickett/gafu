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

console.log("init");
document.addEventListener(
  "mouseenter",
  (event) => {
    let hoveredElement = event.target;

    // Check if the hovered element is a <p> and its parent is a span with class 'current-caption'
    if (
      hoveredElement.tagName === "P" &&
      hoveredElement.parentNode.classList.contains("current-caption")
    ) {
      console.log(
        "Hovering over the <p> inside a span with class 'current-caption'",
      );

      // Add keydown event listener
      document.addEventListener("keydown", keydownHandler);
    }
  },
  true,
); // Use capture phase to handle the event

document.addEventListener(
  "mouseleave",
  (event) => {
    let hoveredElement = event.target;

    // Check if the hovered element is a <p> and its parent is a span with class 'current-caption'
    if (
      hoveredElement.tagName === "P" &&
      hoveredElement.parentNode.classList.contains("current-caption")
    ) {
      // Remove keydown event listener
      document.removeEventListener("keydown", keydownHandler);
    }
  },
  true,
); // Use capture phase to handle the event

function keydownHandler(event) {
  console.log(
    `Key "${event.key}" was pressed while hovering over the <p> inside a span with class 'current-caption'`,
  );
  // Call your function here
}

let keys = {
  a: false,
  s: false,
};

document.addEventListener("keydown", async function (event) {
  // Make the function async
  if (event.ctrlKey) {
    keys.a = true;
  }
  if (event.key === " ") {
    keys.s = true;
  }

  if (keys.a && keys.s) {
    keys.a = false;
    keys.s = false;
    console.log("both the keys pressed at once");

    console.log("keys pressed");
    // Get the content of the <p> tag inside the span with class 'current-caption'
    let pContent = document.querySelector(".current-caption p").textContent;

    try {
      // Send a POST request to the /append endpoint
      let response = await fetch("http://localhost:8000/append", {
        // Use await here
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input_string: pContent }),
      });

      let data = await response.json(); // Use await here

      gpt_sentence_info_csv_to_array(data);

      console.log("data: ", data); // Now you can access data here
    } catch (error) {
      console.error("Error:", error);
    }
  }
});

const gpt_sentence_info_csv_to_array = (data) => {
  str = data.appended_string.content;
  let arr = str.split(",");
  let result = [];

  for (let i = 0; i < arr.length; i += 3) {
    result.push({
      token: arr[i],
      part_of_speech: arr[i + 1],
      meaning: arr[i + 2],
    });
  }

  let newContent = result
    .map((token) => {
      // Wrap each token in a span with a tooltip
      return `<span class='token' data-tooltip='${token.token} -   ${token.part_of_speech} - ${token.meaning}'>${token.token}</span>`;
    })
    .join("        "); // Three spaces between each token

  let strWithoutQuotes = newContent.replace(/"/g, ""); // g is for global, to replace all occurrences

  document.querySelector(".current-caption p").innerHTML = strWithoutQuotes; // Use innerHTML to insert HTML content
};

// make this get all the furigana for that sentence at once
async function getFurigana(text) {
  const response = await fetch("http://localhost:5000/furigana", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: text }),
  });
  const data = await response.json();
  return data.furigana;
}
