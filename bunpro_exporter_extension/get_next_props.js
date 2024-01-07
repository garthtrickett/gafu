// get_next_props.js
window.addEventListener("postMessageEvent", function () {
  var dataElement = document.getElementById("__NEXT_DATA__");
  var dataJson = JSON.parse(dataElement.textContent);
  window.postMessage(
    {
      type: "FROM_PAGE",
      text: dataJson.props.pageProps,
    },
    "*",
  );
});
