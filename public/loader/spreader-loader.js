/**
 * SpreaderLoader - Canvas-baserad loading animation med gödselspridare
 * 
 * Animation visar en centrifugalspridare som kastar ut granulat över hela skärmen
 */

class SpreaderLoader {
  constructor(options = {}) {
    this.options = {
      minDisplayTime: options.minDisplayTime || 800,  // Minimum visningstid (ms)
      loopDuration: 2800,                              // Loop-längd (ms)
      maxParticles: 1500,                              // Max antal partiklar samtidigt (ökat från 800)
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
    };
    
    this.overlay = null;
    this.canvas = null;
    this.ctx = null;
    this.particles = [];
    this.animationId = null;
    this.startTime = 0;
    this.lastFrameTime = 0;
    this.rotation = 0;
    this.vibrationOffset = 0;
    this.isVisible = false;
    this.showTimestamp = 0;
    this.tractorY = 0; // Traktorns Y-position för animation
    
    // Load spreader image - TEST med traktor-spridare bild
    this.spreaderImage = new Image();
    this.spreaderImage.src = '/traktor-spridare.png';  // Ändrad från /spridare.png
    this.imageLoaded = false;
    this.spreaderImage.onload = () => {
      this.imageLoaded = true;
    };
    
    // Tracking för höjsta landade partikel (för growing effect)
    this.lowestLandedY = window.innerHeight;
    
    this._init();
  }
  
  /**
   * Initialisera DOM och canvas
   */
  _init() {
    // Skapa overlay
    this.overlay = document.createElement('div');
    this.overlay.className = 'spreader-overlay';
    this.overlay.setAttribute('role', 'status');
    this.overlay.setAttribute('aria-live', 'polite');
    
    // Skärmläsartext
    const srText = document.createElement('span');
    srText.className = 'sr-only';
    srText.textContent = 'Beräknar rekommendationer...';
    this.overlay.appendChild(srText);
    
    // ===== INTRO OVERLAY (Steg 1) =====
    this.introOverlay = document.createElement('div');
    this.introOverlay.className = 'spreader-intro-overlay';
    this.introOverlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      z-index: 10003;
      opacity: 0;
      transition: opacity 0.4s ease;
      pointer-events: none;
    `;
    
    // Intro container
    this.introContainer = document.createElement('div');
    this.introContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 24px;
      transform: translateY(20px);
      opacity: 0;
      transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
    `;
    
    // Kombinationstext (snyggare styling)
    this.combinationsText = document.createElement('div');
    this.combinationsText.className = 'spreader-combinations-text';
    this.combinationsText.style.cssText = `
      color: white;
      font-size: 1.25rem;
      font-weight: 500;
      text-align: center;
      text-shadow: 0 2px 12px rgba(0,0,0,0.3);
      max-width: 400px;
      line-height: 1.5;
      letter-spacing: 0.02em;
    `;
    this.introContainer.appendChild(this.combinationsText);
    
    // Spinner/loader animation
    this.spinnerContainer = document.createElement('div');
    this.spinnerContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    `;
    
    // Pulsande ring-loader
    this.spinner = document.createElement('div');
    this.spinner.style.cssText = `
      width: 60px;
      height: 60px;
      border: 3px solid rgba(255,255,255,0.2);
      border-top-color: #4CAF50;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    `;
    
    // Progress dots
    this.progressDots = document.createElement('div');
    this.progressDots.style.cssText = `
      display: flex;
      gap: 8px;
    `;
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('div');
      dot.style.cssText = `
        width: 8px;
        height: 8px;
        background: rgba(255,255,255,0.4);
        border-radius: 50%;
        animation: pulse 1.4s ease-in-out infinite;
        animation-delay: ${i * 0.2}s;
      `;
      this.progressDots.appendChild(dot);
    }
    
    this.spinnerContainer.appendChild(this.spinner);
    this.spinnerContainer.appendChild(this.progressDots);
    this.introContainer.appendChild(this.spinnerContainer);
    
    this.introOverlay.appendChild(this.introContainer);
    
    // Lägg till CSS-animationer
    if (!document.getElementById('spreader-intro-styles')) {
      const style = document.createElement('style');
      style.id = 'spreader-intro-styles';
      style.textContent = `
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.2); }
        }
      `;
      document.head.appendChild(style);
    }
    
    // ===== SPREADER OVERLAY (Steg 2) =====
    // Blur-lager som kommer växa bort
    this.blurLayer = document.createElement('div');
    this.blurLayer.className = 'spreader-blur-layer';
    this.overlay.appendChild(this.blurLayer);
    
    // Canvas
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'spreader-canvas';
    this.overlay.appendChild(this.canvas);
    
    this.ctx = this.canvas.getContext('2d');
    
    // Resize handler
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }
  
  /**
   * Anpassa canvas-storlek till viewport
   */
  resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this.ctx.scale(dpr, dpr);
    
    // Justera max partiklar baserat på skärmstorlek
    const screenArea = window.innerWidth * window.innerHeight;
    this.options.maxParticles = Math.min(300, Math.floor(screenArea / 5000));
  }
  
  /**
   * Visa loader med tvåstegssekvens:
   * Steg 1: Intro med kombinationstext och spinner (3 sek)
   * Steg 2: Spreader-animation med blur
   * 
   * @param {number} [combinations] - Antal möjliga kombinationer att visa
   */
  show(combinations) {
    // Legacy metod - anropa nya metoder
    this.showIntro(combinations);
  }
  
  /**
   * Återställ loader-state för ny beräkning
   * Anropas innan showIntro() för att säkerställa ren start
   */
  reset() {
    // Avbryt pågående timeouts
    if (this.introTimeout) {
      clearTimeout(this.introTimeout);
      this.introTimeout = null;
    }
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    
    // Ta bort från DOM (med null-kontroll)
    if (this.introOverlay && this.introOverlay.parentElement) {
      this.introOverlay.parentElement.removeChild(this.introOverlay);
    }
    if (this.overlay && this.overlay.parentElement) {
      this.overlay.parentElement.removeChild(this.overlay);
    }
    
    // Återställ CSS-klasser (med null-kontroll)
    if (this.overlay) {
      this.overlay.classList.remove('visible');
    }
    if (this.introOverlay) {
      this.introOverlay.style.opacity = '0';
    }
    if (this.introContainer) {
      this.introContainer.style.opacity = '0';
      this.introContainer.style.transform = 'translateY(20px)';
    }
    
    // Rensa partiklar
    this.particles = [];
    
    // Återställ state-flaggor
    this.isVisible = false;
    this.introEnded = false;
    this.introCancelled = false;
    this.introPromise = null;
    this.introResolve = null;
  }
  
  /**
   * STEG 1: Visa intro (text + spinner)
   * Anropas direkt när beräkning startar
   * 
   * @param {number} [combinations] - Antal möjliga kombinationer
   */
  showIntro(combinations) {
    if (this.isVisible) return;
    
    this.isVisible = true;
    this.showTimestamp = Date.now();
    this.introDuration = 3000; // 3 sekunder minimum intro
    this.introEnded = false;
    this.introCancelled = false;
    
    // Promise som resolvas när intro är klar
    this.introPromise = new Promise((resolve) => {
      this.introResolve = resolve;
    });
    
    // Sätt kombinationstext
    if (combinations && combinations > 0) {
      const formattedNum = combinations.toLocaleString('sv-SE');
      this.combinationsText.textContent = `Beräknar bästa lösning av ${formattedNum} möjliga kombinationer...`;
    } else {
      this.combinationsText.textContent = 'Beräknar optimala lösningar...';
    }
    
    // Lås scroll
    document.body.classList.add('loading-active');
    
    // Visa intro overlay
    if (!this.introOverlay.parentElement) {
      document.body.appendChild(this.introOverlay);
    }
    
    // Fade in intro
    requestAnimationFrame(() => {
      this.introOverlay.style.opacity = '1';
      // Animera in containern
      setTimeout(() => {
        this.introContainer.style.opacity = '1';
        this.introContainer.style.transform = 'translateY(0)';
      }, 100);
    });
    
    // Sätt timeout för intro-slutet
    this.introTimeout = setTimeout(() => {
      this.introEnded = true;
      if (this.introResolve) {
        this.introResolve();
      }
    }, this.introDuration);
  }
  
  /**
   * Vänta tills intro-fasen är klar (minst 3 sek)
   * @returns {Promise} Resolvas när intro är klar
   */
  async waitForIntro() {
    if (this.introCancelled) return;
    if (this.introEnded) return;
    if (!this.introPromise) return; // Säkerhet om intro aldrig startades
    return this.introPromise;
  }
  
  /**
   * Avbryt intro-fasen (vid fel)
   */
  cancelIntro() {
    this.introCancelled = true;
    if (this.introTimeout) {
      clearTimeout(this.introTimeout);
      this.introTimeout = null;
    }
    if (this.introResolve) {
      this.introResolve();
    }
    // Göm intro direkt
    this.introOverlay.style.opacity = '0';
    setTimeout(() => {
      if (this.introOverlay.parentElement) {
        this.introOverlay.parentElement.removeChild(this.introOverlay);
      }
    }, 400);
  }
  
  /**
   * STEG 2: Starta spreader-animation
   * Anropas efter att data har laddats och intro är klar
   */
  startSpreader() {
    if (this.introCancelled) return;
    this._startSpreaderPhase();
  }
  
  /**
   * Starta steg 2 - spreader-fasen
   */
  _startSpreaderPhase() {
    // Initiera spreader-state
    this.startTime = Date.now();
    this.lastFrameTime = this.startTime;
    this.tractorY = window.innerHeight + 200;
    this.lowestLandedY = window.innerHeight + 500;
    
    // FÖRST: Lägg till spreader overlay (med blur) INNAN vi tar bort intro
    // Detta säkerställer att blur alltid finns
    if (!this.overlay.parentElement) {
      document.body.appendChild(this.overlay);
    }
    
    // Gör spreader overlay synlig direkt (utan fade) - bluren finns redan
    this.overlay.classList.add('visible');
    
    // Starta animation loop direkt
    this._animate();
    
    // SEDAN: Fade ut intro (spreader blur ligger redan under)
    this.introContainer.style.opacity = '0';
    this.introContainer.style.transform = 'translateY(-20px)';
    
    setTimeout(() => {
      this.introOverlay.style.opacity = '0';
      
      // Ta bort intro efter fade
      setTimeout(() => {
        if (this.introOverlay.parentElement) {
          this.introOverlay.parentElement.removeChild(this.introOverlay);
        }
      }, 400);
    }, 200);
  }
  
  /**
   * Dölj loader (väntar på minDisplayTime)
   */
  async hide() {
    if (!this.isVisible) return;
    
    // Avbryt intro-timeout om vi gömmer tidigt
    if (this.introTimeout) {
      clearTimeout(this.introTimeout);
      this.introTimeout = null;
    }
    
    // Beräkna hur länge vi varit synliga (inkl. intro)
    const elapsed = Date.now() - this.showTimestamp;
    const totalMinTime = this.introDuration + this.options.minDisplayTime;
    const remaining = Math.max(0, totalMinTime - elapsed);
    
    // Om vi fortfarande är i intro-fasen, starta spreader först
    if (elapsed < this.introDuration && this.introOverlay.parentElement) {
      this._startSpreaderPhase();
      // Vänta på spreader minDisplayTime
      await new Promise(resolve => setTimeout(resolve, this.options.minDisplayTime));
    } else if (remaining > 0) {
      await new Promise(resolve => setTimeout(resolve, remaining));
    }
    
    // Stoppa emission
    this.isVisible = false;
    
    // Låt partiklar leva ut (200ms)
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Fade out
    this.overlay.classList.remove('visible');
    
    // Stoppa animation efter fade
    setTimeout(() => {
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
      }
      
      // Rensa partiklar
      this.particles = [];
      
      // Lås upp scroll
      document.body.classList.remove('loading-active');
      
      // Ingen scroll här - den sker redan innan animationen startade
      
      // Ta bort från DOM
      if (this.overlay.parentElement) {
        this.overlay.parentElement.removeChild(this.overlay);
      }
    }, 300);
  }
  
  /**
   * Huvudanimationsloop
   */
  _animate() {
    const now = Date.now();
    const deltaTime = (now - this.lastFrameTime) / 1000; // Sekunder
    this.lastFrameTime = now;
    
    // Beräkna loop-position (0-1)
    const loopTime = (now - this.startTime) % this.options.loopDuration;
    const loopProgress = loopTime / this.options.loopDuration;
    
    // Beräkna traktorns Y-position (kör från botten till toppen över minDisplayTime)
    const totalElapsed = now - this.startTime;
    const travelProgress = Math.min(1, totalElapsed / this.options.minDisplayTime);
    const startY = window.innerHeight + 200;
    const endY = -300;
    this.tractorY = startY + (endY - startY) * travelProgress;
    
    // Rensa canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Rita spridare
    this._drawSpreader(deltaTime, loopProgress);
    
    // Uppdatera och rita partiklar
    if (!this.options.reducedMotion) {
      this._updateParticles(deltaTime, loopProgress);
      this._drawParticles();
      
      // Emittera nya partiklar
      if (this.isVisible) {
        this._emitParticles(loopProgress);
      }
    }
    
    // Fortsätt loop
    this.animationId = requestAnimationFrame(() => this._animate());
  }
  
  /**
   * Rita gödselspridaren
   */
  _drawSpreader(deltaTime, loopProgress) {
    const ctx = this.ctx;
    const centerX = window.innerWidth / 2;
    
    // Vänta tills bilden är laddad
    if (!this.imageLoaded) {
      return;
    }
    
    ctx.save();
    
    // Lägg till guppande rörelse (horisontell svajar + vertikal gupp)
    let bounceX = 0;
    let bounceY = 0;
    
    if (!this.options.reducedMotion) {
      const time = Date.now();
      // Horisontell svajar (långsammare, större amplitud)
      bounceX = Math.sin(time / 1200 * Math.PI * 2) * 8;
      // Vertikal gupp (snabbare, mindre amplitud)
      bounceY = Math.sin(time / 600 * Math.PI * 2) * 3;
      // Extra vibration
      const vibration = Math.sin(time / 150 * Math.PI * 2) * 0.5;
      bounceY += vibration;
    }
    
    ctx.translate(centerX + bounceX, this.tractorY + bounceY);
    
    // Rita spridare-bilden i normal storlek
    const imgWidth = this.spreaderImage.width;
    const imgHeight = this.spreaderImage.height;
    
    // Skala ner om bilden är för stor (max 240px bredd för traktor-bilden)
    let drawWidth = imgWidth;
    let drawHeight = imgHeight;
    const maxWidth = 240;  // Minskad från 300 till 240
    if (drawWidth > maxWidth) {
      const scale = maxWidth / drawWidth;
      drawWidth *= scale;
      drawHeight *= scale;
    }
    
    ctx.drawImage(
      this.spreaderImage,
      -drawWidth / 2,
      -drawHeight / 2,
      drawWidth,
      drawHeight
    );
    
    ctx.restore();
    
    // Spara emission point för partiklar - från tallrikarna på spridaren
    // Partiklar kommer härifrån och sprids sedan ut som en solfjäder
    // Inkludera bounce i emission point också!
    this.emissionPoint = {
      x: centerX + bounceX,
      y: this.tractorY + bounceY + drawHeight * 0.2 // Från tallrikarna
    };
  }
  
  /**
   * Emittera nya partiklar baserat på loop-fas
   */
  _emitParticles(loopProgress) {
    // Bestäm emission multiplier baserat på fas
    let emissionMult = 1.0;
    if (loopProgress < 0.20) {
      // Spool-up: 0-20%
      emissionMult = 0.3 + (loopProgress / 0.20) * 0.7;
    } else if (loopProgress > 0.85) {
      // Taper: 85-100%
      emissionMult = 0.2 + (1 - (loopProgress - 0.85) / 0.15) * 0.8;
    }
    
    // ÖS PÅ MED GÖDSEL från tallrikarna som en SOLFJÄDER åt BÅDA HÅLL!
    const particlesPerFrame = Math.floor(40 * emissionMult);
    
    for (let i = 0; i < particlesPerFrame; i++) {
      if (this.particles.length >= this.options.maxParticles) break;
      
      // Alla partiklar kommer från tallrikarna (emissionPoint)
      // Men sprids i olika vinklar för att täcka hela bredden (solfjäder)
      // Vinklar från 90° (vänster) till -90° (höger) via toppen (0° = uppåt)
      // För att få symmetrisk spridning åt båda håll
      const spreadAngle = (Math.random() * 180 - 90) * Math.PI / 180;
      
      this.particles.push(this._createParticleWithAngle(this.emissionPoint, spreadAngle));
    }
  }
  
  /**
   * Skapa en ny partikel med specifik vinkel (solfjäder-effekt)
   */
  _createParticleWithAngle(position, angle) {
    // Högre hastighet för partiklar som ska täcka hela bredden
    const baseSpeed = 200 + Math.random() * 150; // 200-350 px/s för bred täckning
    
    // Hastighet i X och Y baserat på vinkeln
    // angle: -90° (höger) till 90° (vänster) via 0° (uppåt)
    // Sin ger X (höger/vänster), Cos ger Y (upp/ner men vi inverterar för skärmkoordinater)
    const vx = baseSpeed * Math.sin(angle);  // Sin för horisontell spridning
    const vy = -baseSpeed * Math.cos(angle); // -Cos för vertikal (negativ = uppåt)
    
    return {
      x: position.x,
      y: position.y,
      vx: vx,
      vy: vy,
      life: 1.0,
      maxLife: 1.5 + Math.random(),
      size: 1.5 + Math.random() * 2, // 1.5-3.5px som grus/granulat
      color: this._getParticleColor(),
      opacity: 0.85 + Math.random() * 0.15
    };
  }
  
  /**
   * Få partikel-färg (grus-liknande med vit, grå och lite svart)
   */
  _getParticleColor() {
    const colors = [
      '#FFFFFF', // Vit
      '#F5F5F5', // Ljusgrå
      '#E8E8E8', // Grå
      '#CCCCCC', // Mörkare grå
      '#B0B0B0', // Än mörkare grå
      '#909090', // Mörk grå
      '#808080', // Grå (50%)
      '#606060'  // Nästan svart grå
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }
  
  /**
   * Uppdatera alla partiklar
   */
  _updateParticles(deltaTime) {
    const gravity = 50; // px/s²
    const centerX = window.innerWidth / 2;
    
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      
      // Uppdatera position
      p.x += p.vx * deltaTime;
      p.y += p.vy * deltaTime;
      
      // Gravitation
      p.vy += gravity * deltaTime;
      
      // Uppdatera life
      p.life -= deltaTime / p.maxLife;
      
      // Fade baserat på avstånd från centrum
      const distFromCenter = Math.abs(p.x - centerX);
      const maxDist = window.innerWidth / 2;
      const distFade = 1 - Math.min(1, distFromCenter / maxDist);
      
      // Tracka var granulerna landar - bara när de är på väg nedåt
      // Detta ger mer realistisk "landing" detection
      if (p.vy > 0) { // På väg nedåt
        this.lowestLandedY = Math.min(this.lowestLandedY, p.y);
      }
      
      // Ta bort döda partiklar eller partiklar utanför skärmen
      if (p.life <= 0 || p.y > window.innerHeight + 50 || Math.abs(p.x - centerX) > window.innerWidth / 2 + 50) {
        this.particles.splice(i, 1);
      }
    }
    
    // Uppdatera blur-mask baserat på var granulerna landat
    this._updateBlurMask();
  }
  
  /**
   * Uppdatera blur-mask så att bluren växer bort där granulerna landat
   */
  _updateBlurMask() {
    if (!this.blurLayer) return;
    
    // Om inga partiklar har landat än (lowestLandedY är fortfarande under skärmen), visa ingen blur
    if (this.lowestLandedY > window.innerHeight) {
      this.blurLayer.style.maskImage = 'none';
      this.blurLayer.style.webkitMaskImage = 'none';
      return;
    }
    
    // Lägg till offset så bluren försvinner 200px BAKOM traktorn (där gödsel faktiskt landar)
    const landingOffset = 200;
    const blurEndY = this.lowestLandedY + landingOffset;
    
    // Skapa en gradient-mask med 200px fade för mjukare övergång
    const fadeSize = 200; // px för mjuk övergång
    const gradientStart = Math.max(0, blurEndY - fadeSize);
    const gradientEnd = blurEndY;
    
    // Konvertera till procent
    const startPercent = (gradientStart / window.innerHeight) * 100;
    const endPercent = (gradientEnd / window.innerHeight) * 100;
    
    // Linear gradient mask: opaque från toppen, fade vid kanten, transparent efter
    this.blurLayer.style.maskImage = `linear-gradient(to bottom, 
      rgba(0,0,0,1) 0%, 
      rgba(0,0,0,1) ${startPercent}%, 
      rgba(0,0,0,0) ${endPercent}%)`;
    this.blurLayer.style.webkitMaskImage = `linear-gradient(to bottom, 
      rgba(0,0,0,1) 0%, 
      rgba(0,0,0,1) ${startPercent}%, 
      rgba(0,0,0,0) ${endPercent}%)`;
  }
  
  /**
   * Rita alla partiklar
   */
  _drawParticles() {
    const ctx = this.ctx;
    const centerX = window.innerWidth / 2;
    const maxDist = window.innerWidth / 2;
    
    for (const p of this.particles) {
      // Beräkna opacity baserat på life och avstånd
      const distFromCenter = Math.abs(p.x - centerX);
      const distFade = 1 - Math.pow(distFromCenter / maxDist, 1.5);
      const finalOpacity = p.opacity * p.life * distFade;
      
      ctx.fillStyle = p.color;
      ctx.globalAlpha = finalOpacity;
      
      // Rita partikel som liten grus-prick (fylld cirkel, ingen kant)
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    
    ctx.globalAlpha = 1.0;
  }
}

// Gör tillgänglig globalt
window.SpreaderLoader = SpreaderLoader;
