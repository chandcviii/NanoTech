// UI Interactions
document.querySelectorAll('.tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b === btn));
    document.querySelectorAll('.tabpane').forEach(p => p.hidden = p.id !== btn.dataset.tab);
  });
});

// Quiz Logic
const quizQuestions = [
  { q: 'Nanotechnology works with materials of what size range?', options: ['1 to 100 nanometers', '100 to 1000 nanometers', '1 to 100 micrometers', '1 to 100 millimeters'], answer: 0, explain: 'Nanotechnology works with materials roughly 1 to 100 nanometers in size.' },
  { q: 'Why are smaller nanoparticles more reactive?', options: ['Higher surface area, so more atoms are on the surface', 'They are heavier', 'They contain more water', 'They are always magnetic'], answer: 0, explain: 'Smaller particles have more atoms on their surface, which raises their reactivity.' },
  { q: 'Why does the ability of nanoparticles to cross the blood-brain barrier raise concern?', options: ['Toxicity and bioaccumulation', 'Faster Wi-Fi', 'Lower drug cost', 'Brighter colors'], answer: 0, explain: 'Nanoparticles can cross the blood-brain barrier, raising concerns about toxicity and bioaccumulation.' },
  { q: 'What does the "nano-divide" refer to?', options: ['Unequal access', 'Splitting atoms', 'A type of nanoparticle', 'A lab safety rule'], answer: 0, explain: 'The nano-divide describes unequal access to the benefits of nanotechnology.' },
  { q: 'Which Philippine innovation detects African Swine Fever in 30 minutes?', options: ['Nanogold biosensor kit (Central Luzon State University)', 'Mabuhay Straw', 'Nanotextured steel implants', 'Nano plant growth regulator'], answer: 0, explain: 'Central Luzon State University built a nanogold biosensor kit that detects African Swine Fever in 30 minutes.' }
];

const quizApp = document.getElementById('quizApp');
let quizAttempt = [], quizIndex = 0, quizScore = 0;

function shuffleQuizItems(items) {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
function startQuiz() {
  quizAttempt = shuffleQuizItems(quizQuestions).map(question => {
    const options = question.options.map((text, index) => ({ text, correct: index === question.answer }));
    return { ...question, shuffledOptions: shuffleQuizItems(options) };
  });
  quizIndex = 0;
  quizScore = 0;
  renderQuizQuestion();
}

function renderQuizQuestion() {
  const question = quizAttempt[quizIndex];
  const progress = (quizIndex / quizAttempt.length) * 100;
  quizApp.innerHTML = `
    <div class="quiz-meta">
      <span>Question ${quizIndex + 1} of ${quizAttempt.length}</span>
      <span class="quiz-score">Score: ${quizScore}/${quizAttempt.length}</span>
    </div>
    <div class="quiz-progress" role="progressbar" aria-label="Quiz progress" aria-valuemin="0" aria-valuemax="${quizAttempt.length}" aria-valuenow="${quizIndex}">
      <div class="quiz-progress-fill" style="width:${progress}%"></div>
    </div>
    <h3 class="quiz-question">${question.q}</h3>
    <div class="quiz-options">
      ${question.shuffledOptions.map((option, index) => `<button class="quiz-option" type="button" data-option="${index}">${option.text}</button>`).join('')}
    </div>
    <p class="quiz-feedback" aria-live="polite"></p>
    <div class="quiz-actions"></div>
  `;
  quizApp.querySelectorAll('.quiz-option').forEach(button => {
    button.addEventListener('click', () => selectQuizAnswer(Number(button.dataset.option)));
  });
}

function selectQuizAnswer(selectedIndex) {
  const question = quizAttempt[quizIndex];
  const options = quizApp.querySelectorAll('.quiz-option');
  const feedback = quizApp.querySelector('.quiz-feedback');
  const selectedOption = question.shuffledOptions[selectedIndex];

  options.forEach((button, index) => {
    button.disabled = true;
    if (question.shuffledOptions[index].correct) button.classList.add('is-correct');
    if (index === selectedIndex && !selectedOption.correct) button.classList.add('is-wrong');
  });

  if (selectedOption.correct) quizScore++;
  feedback.textContent = `${selectedOption.correct ? 'Correct!' : 'Not quite.'} ${question.explain}`;

  const nextButton = document.createElement('button');
  nextButton.className = 'btn primary';
  nextButton.type = 'button';
  nextButton.textContent = quizIndex === quizAttempt.length - 1 ? 'See results' : 'Next';
  nextButton.addEventListener('click', () => {
    quizIndex++;
    if (quizIndex === quizAttempt.length) renderQuizResults();
    else renderQuizQuestion();
  });
  quizApp.querySelector('.quiz-actions').append(nextButton);
}

function renderQuizResults() {
  const message = quizScore === quizAttempt.length ? 'Excellent work - you got every question right!' : quizScore >= 3 ? 'Good work - you have a solid grasp of the key ideas.' : 'Keep exploring the page and try again to strengthen your knowledge.';
  quizApp.innerHTML = `
    <div class="quiz-results">
      <h3>Quiz complete</h3>
      <p class="quiz-results-score">${quizScore}/${quizAttempt.length}</p>
      <p>${message}</p>
      <button class="btn primary" type="button">Try again</button>
    </div>
  `;
  quizApp.querySelector('button').addEventListener('click', startQuiz);
}
startQuiz();

// Sticky Header & Scroll Logic
const nav = document.querySelector('.nav');
const glassNav = document.querySelector('.nav');
let glassNavFramePending = false;

window.addEventListener('scroll', () => {
  if (glassNavFramePending) return;
  glassNavFramePending = true;
  requestAnimationFrame(() => {
    glassNav.classList.toggle('scrolled', window.scrollY > 20);
    glassNavFramePending = false;
  });
}, { passive: true });

glassNav.classList.toggle('scrolled', window.scrollY > 20);

const navLinksBySection = new Map(
  [...glassNav.querySelectorAll('nav a[href^="#"]')]
    .map(link => [document.querySelector(link.getAttribute('href')), link])
    .filter(([section]) => section)
);

if ('IntersectionObserver' in window && navLinksBySection.size) {
  const visibleSections = new Map();
  const sectionObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => visibleSections.set(entry.target, entry));
    const currentSection = [...visibleSections.entries()]
      .filter(([, entry]) => entry.isIntersecting)
      .sort((a, b) => b[1].intersectionRatio - a[1].intersectionRatio)[0]?.[0];

    navLinksBySection.forEach((link, section) => {
      const isActive = section === currentSection;
      link.classList.toggle('active', isActive);
      if (isActive) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  }, { rootMargin: '-70px 0px -55% 0px', threshold: [0, .25, .5, .75, 1] });

  navLinksBySection.forEach((_, section) => sectionObserver.observe(section));
}
