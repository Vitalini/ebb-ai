(function () {
  if (!navigator.clipboard) return;
  document.querySelectorAll("pre.code").forEach(function (pre) {
    if (pre.querySelector(".copy-btn")) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy-btn";
    btn.textContent = "Copy";
    btn.setAttribute("aria-label", "Copy code to clipboard");
    pre.appendChild(btn);
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var clone = pre.cloneNode(true);
      var b = clone.querySelector(".copy-btn");
      if (b) b.remove();
      var text = clone.textContent.replace(/\n+$/, "");
      navigator.clipboard.writeText(text).then(function () {
        btn.textContent = "Copied";
        btn.classList.add("copied");
        setTimeout(function () {
          btn.textContent = "Copy";
          btn.classList.remove("copied");
        }, 1400);
      });
    });
  });
})();
