document.addEventListener('DOMContentLoaded', function() {
  var toggle = document.querySelector('.nav-toggle');
  var links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', function() {
      links.classList.toggle('active');
      toggle.setAttribute('aria-expanded', links.classList.contains('active'));
    });
    // Close menu when clicking a link
    links.querySelectorAll('a').forEach(function(link) {
      link.addEventListener('click', function() {
        links.classList.remove('active');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }
  // Set active nav state
  var path = window.location.pathname.replace(/\/$/, '') || '/';
  document.querySelectorAll('.nav-links a').forEach(function(a) {
    var href = a.getAttribute('href').replace(/\/$/, '') || '/';
    if (href === path) a.classList.add('active');
  });
});
