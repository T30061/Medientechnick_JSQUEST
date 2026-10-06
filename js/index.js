// Reveal marked elements as they enter view; honor accessibility motion settings.
(() => {
	const init = () => {
		const greetingForm = document.querySelector('#greeting-form');
		const nameInput = document.querySelector('#visitor-name');
		const greetingOutput = document.querySelector('#greeting-output');

		if (greetingForm && nameInput && greetingOutput) {
			greetingForm.addEventListener('submit', (event) => {
				event.preventDefault();
				const name = nameInput.value.trim();
				greetingOutput.textContent = name ? `Hallo, ${name}! Schön, dass du JavaScript ausprobierst. ✨` : 'Hallo, Web! Schön, dass du JavaScript ausprobierst. ✨';
			});
		}

		const elements = document.querySelectorAll('[data-reveal]');
		const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

		if (reducedMotion || !('IntersectionObserver' in window)) {
			elements.forEach((element) => element.classList.add('is-visible'));
		} else {
			const observer = new IntersectionObserver((entries, activeObserver) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting) {
						entry.target.classList.add('is-visible');
						activeObserver.unobserve(entry.target);
					}
				});
			}, { threshold: 0.15 });
			elements.forEach((element) => observer.observe(element));
		}

		// Prevent reverse-tabnabbing for links that open a new tab.
		document.querySelectorAll('a[target="_blank"]').forEach((link) => {
			const rel = new Set((link.getAttribute('rel') || '').split(/\s+/).filter(Boolean));
			rel.add('noopener');
			rel.add('noreferrer');
			link.setAttribute('rel', [...rel].join(' '));
		});
	};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init, { once: true });
	} else {
		init();
	}
})();
