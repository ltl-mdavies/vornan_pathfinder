/** Portable Vornan compass loader. Import once, then use <vornan-compass-loader>. */
const template = document.createElement('template');
template.innerHTML = `<style>
:host { display:inline-flex; width:var(--compass-size, 64px); height:var(--compass-size, 64px); vertical-align:middle; flex-shrink:0; color:var(--compass-color, inherit); }
svg { width:100%; height:100%; overflow:visible; }
.motion { transform-origin:512px 512px; animation:compass-turn linear infinite; animation-play-state:var(--compass-play-state, running); }
.ring { animation-duration:var(--compass-ring-duration, 12s); animation-direction:var(--compass-ring-direction, normal); }
.primary { animation-duration:var(--compass-primary-duration, 8s); animation-direction:var(--compass-primary-direction, reverse); }
.secondary { animation-duration:var(--compass-secondary-duration, 6s); animation-direction:var(--compass-secondary-direction, normal); }
:host([paused]) .motion { animation-play-state:paused; }
:host([detail="simple"]) line { display:none; }
@keyframes compass-turn { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion:reduce) { .motion { animation:none; } }
</style><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
  <defs>
    <mask id="secondary-silhouette-knockout" maskUnits="userSpaceOnUse">
      <rect x="0" y="0" width="1024" height="1024" fill="white" />
      <polygon points="743.931,280.069 504.929,442.704 512.000,512.000" fill="black" />
      <polygon points="743.931,743.931 581.296,504.929 512.000,512.000" fill="black" />
      <polygon points="280.069,743.931 442.704,504.929 512.000,512.000" fill="black" />
      <polygon points="280.069,280.069 519.071,442.704 512.000,512.000" fill="black" />
      <circle cx="512" cy="512" r="84" fill="black" />
    </mask>
    <mask id="secondary-engraving-knockout" maskUnits="userSpaceOnUse">
      <rect x="0" y="0" width="1024" height="1024" fill="white" />
      <circle cx="512" cy="512" r="84" fill="black" />
    </mask>
    <mask id="primary-silhouette-knockout" maskUnits="userSpaceOnUse">
      <rect x="0" y="0" width="1024" height="1024" fill="white" />
      <polygon points="512.000,92.000 444.000,468.000 512.000,512.000" fill="black" />
      <polygon points="932.000,512.000 556.000,444.000 512.000,512.000" fill="black" />
      <polygon points="512.000,932.000 444.000,556.000 512.000,512.000" fill="black" />
      <polygon points="92.000,512.000 468.000,444.000 512.000,512.000" fill="black" />
      <circle cx="512" cy="512" r="84" fill="black" />
    </mask>
    <mask id="hub-knockout" maskUnits="userSpaceOnUse">
      <rect x="0" y="0" width="1024" height="1024" fill="white" />
      <circle cx="512" cy="512" r="84" fill="black" />
    </mask>
  <mask id="moving-primary" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><rect width="1024" height="1024" fill="white" /><g class="motion primary"><polygon points="512.000,92.000 512.000,512.000 580.000,468.000" fill="black" />
      <polygon points="932.000,512.000 512.000,512.000 556.000,580.000" fill="black" />
      <polygon points="512.000,932.000 512.000,512.000 580.000,556.000" fill="black" />
      <polygon points="92.000,512.000 512.000,512.000 468.000,580.000" fill="black" />
      <polygon points="512.000,92.000 444.000,468.000 512.000,512.000" fill="black" />
      <polygon points="932.000,512.000 556.000,444.000 512.000,512.000" fill="black" />
      <polygon points="512.000,932.000 444.000,556.000 512.000,512.000" fill="black" />
      <polygon points="92.000,512.000 468.000,444.000 512.000,512.000" fill="black" />
      </g></mask></defs>
  <g id="outer-ring" class="motion ring" style="color:var(--compass-ring-color, var(--compass-color, currentColor))">
    <path d="M 536.991 114.785 A 398.000 398.000 0 0 1 909.215 487.009" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" />
    <path d="M 909.215 536.991 A 398.000 398.000 0 0 1 536.991 909.215" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" />
    <path d="M 487.009 909.215 A 398.000 398.000 0 0 1 114.785 536.991" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" />
    <path d="M 114.785 487.009 A 398.000 398.000 0 0 1 487.009 114.785" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" />
    <path d="M 535.735 134.746 A 378.000 378.000 0 0 1 889.254 488.265" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" />
    <path d="M 889.254 535.735 A 378.000 378.000 0 0 1 535.735 889.254" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" />
    <path d="M 488.265 889.254 A 378.000 378.000 0 0 1 134.746 535.735" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" />
    <path d="M 134.746 488.265 A 378.000 378.000 0 0 1 488.265 134.746" fill="none" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" />
    <polygon points="512.000,92.000 521.500,77.000 512.000,62.000 502.500,77.000" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="miter" />
    <circle cx="512.000" cy="49.000" r="8.000" fill="currentColor" stroke="none" stroke-width="0" />
    <polygon points="932.000,512.000 947.000,521.500 962.000,512.000 947.000,502.500" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="miter" />
    <circle cx="975.000" cy="512.000" r="8.000" fill="currentColor" stroke="none" stroke-width="0" />
    <polygon points="512.000,932.000 502.500,947.000 512.000,962.000 521.500,947.000" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="miter" />
    <circle cx="512.000" cy="975.000" r="8.000" fill="currentColor" stroke="none" stroke-width="0" />
    <polygon points="92.000,512.000 77.000,502.500 62.000,512.000 77.000,521.500" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="miter" />
    <circle cx="49.000" cy="512.000" r="8.000" fill="currentColor" stroke="none" stroke-width="0" />
  </g>
  <g id="compass-rose">
    <g mask="url(#moving-primary)"><g class="motion secondary" style="color:var(--compass-secondary-color, var(--compass-color, currentColor))"><g id="secondary-rose-silhouette" mask="url(#secondary-silhouette-knockout)">
      <polygon points="743.931,280.069 512.000,512.000 581.296,519.071" fill="currentColor" stroke="currentColor" stroke-width="6" stroke-linejoin="miter" />
      <polygon points="743.931,743.931 512.000,512.000 504.929,581.296" fill="currentColor" stroke="currentColor" stroke-width="6" stroke-linejoin="miter" />
      <polygon points="280.069,743.931 512.000,512.000 519.071,581.296" fill="currentColor" stroke="currentColor" stroke-width="6" stroke-linejoin="miter" />
      <polygon points="280.069,280.069 512.000,512.000 442.704,519.071" fill="currentColor" stroke="currentColor" stroke-width="6" stroke-linejoin="miter" />
    </g>
    <g id="secondary-rose-engraving" mask="url(#secondary-engraving-knockout)">
      <polygon points="743.931,280.069 504.929,442.704 512.000,512.000" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="miter" />
      <line x1="582.955" y1="434.707" x2="579.239" y2="398.287" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="595.980" y1="422.196" x2="592.564" y2="388.722" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="609.004" y1="409.684" x2="605.889" y2="379.158" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="622.028" y1="397.173" x2="619.214" y2="369.593" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="635.053" y1="384.661" x2="632.539" y2="360.028" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="648.077" y1="372.149" x2="645.864" y2="350.463" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="661.101" y1="359.638" x2="659.189" y2="340.898" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="674.126" y1="347.126" x2="672.514" y2="331.333" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="687.150" y1="334.615" x2="685.839" y2="321.768" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="700.174" y1="322.103" x2="699.164" y2="312.203" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <polygon points="743.931,743.931 581.296,504.929 512.000,512.000" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="miter" />
      <line x1="589.293" y1="582.955" x2="625.713" y2="579.239" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="601.804" y1="595.980" x2="635.278" y2="592.564" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="614.316" y1="609.004" x2="644.842" y2="605.889" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="626.827" y1="622.028" x2="654.407" y2="619.214" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="639.339" y1="635.053" x2="663.972" y2="632.539" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="651.851" y1="648.077" x2="673.537" y2="645.864" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="664.362" y1="661.101" x2="683.102" y2="659.189" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="676.874" y1="674.126" x2="692.667" y2="672.514" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="689.385" y1="687.150" x2="702.232" y2="685.839" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="701.897" y1="700.174" x2="711.797" y2="699.164" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <polygon points="280.069,743.931 442.704,504.929 512.000,512.000" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="miter" />
      <line x1="434.707" y1="582.955" x2="398.287" y2="579.239" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="422.196" y1="595.980" x2="388.722" y2="592.564" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="409.684" y1="609.004" x2="379.158" y2="605.889" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="397.173" y1="622.028" x2="369.593" y2="619.214" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="384.661" y1="635.053" x2="360.028" y2="632.539" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="372.149" y1="648.077" x2="350.463" y2="645.864" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="359.638" y1="661.101" x2="340.898" y2="659.189" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="347.126" y1="674.126" x2="331.333" y2="672.514" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="334.615" y1="687.150" x2="321.768" y2="685.839" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="322.103" y1="700.174" x2="312.203" y2="699.164" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <polygon points="280.069,280.069 519.071,442.704 512.000,512.000" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="miter" />
      <line x1="441.045" y1="434.707" x2="444.761" y2="398.287" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="428.020" y1="422.196" x2="431.436" y2="388.722" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="414.996" y1="409.684" x2="418.111" y2="379.158" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="401.972" y1="397.173" x2="404.786" y2="369.593" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="388.947" y1="384.661" x2="391.461" y2="360.028" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="375.923" y1="372.149" x2="378.136" y2="350.463" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="362.899" y1="359.638" x2="364.811" y2="340.898" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="349.874" y1="347.126" x2="351.486" y2="331.333" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="336.850" y1="334.615" x2="338.161" y2="321.768" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="323.826" y1="322.103" x2="324.836" y2="312.203" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
    </g>
    </g></g><g class="motion primary" style="color:var(--compass-primary-color, var(--compass-color, currentColor))"><g id="primary-rose-silhouette" mask="url(#primary-silhouette-knockout)">
      <polygon points="512.000,92.000 512.000,512.000 580.000,468.000" fill="currentColor" stroke="currentColor" stroke-width="6" stroke-linejoin="miter" />
      <polygon points="932.000,512.000 512.000,512.000 556.000,580.000" fill="currentColor" stroke="currentColor" stroke-width="6" stroke-linejoin="miter" />
      <polygon points="512.000,932.000 512.000,512.000 580.000,556.000" fill="currentColor" stroke="currentColor" stroke-width="6" stroke-linejoin="miter" />
      <polygon points="92.000,512.000 512.000,512.000 468.000,580.000" fill="currentColor" stroke="currentColor" stroke-width="6" stroke-linejoin="miter" />
    </g>
    <g id="primary-rose-engraving" mask="url(#hub-knockout)">
      <polygon points="512.000,92.000 444.000,468.000 512.000,512.000" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="miter" />
      <line x1="505.786" y1="407.829" x2="466.429" y2="382.363" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="506.102" y1="391.734" x2="468.751" y2="367.566" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="506.419" y1="375.639" x2="471.074" y2="352.768" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="506.736" y1="359.544" x2="473.396" y2="337.971" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="507.053" y1="343.449" x2="475.718" y2="323.174" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="507.369" y1="327.354" x2="478.041" y2="308.376" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="507.686" y1="311.259" x2="480.363" y2="293.579" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="508.003" y1="295.163" x2="482.686" y2="278.782" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="508.319" y1="279.068" x2="485.008" y2="263.985" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="508.636" y1="262.973" x2="487.330" y2="249.187" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="508.953" y1="246.878" x2="489.653" y2="234.390" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="509.269" y1="230.783" x2="491.975" y2="219.593" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="509.586" y1="214.688" x2="494.297" y2="204.795" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="509.903" y1="198.593" x2="496.620" y2="189.998" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="510.219" y1="182.498" x2="498.942" y2="175.201" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="510.536" y1="166.403" x2="501.264" y2="160.403" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <polygon points="932.000,512.000 556.000,444.000 512.000,512.000" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="miter" />
      <line x1="616.171" y1="505.786" x2="641.637" y2="466.429" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="632.266" y1="506.102" x2="656.434" y2="468.751" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="648.361" y1="506.419" x2="671.232" y2="471.074" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="664.456" y1="506.736" x2="686.029" y2="473.396" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="680.551" y1="507.053" x2="700.826" y2="475.718" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="696.646" y1="507.369" x2="715.624" y2="478.041" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="712.741" y1="507.686" x2="730.421" y2="480.363" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="728.837" y1="508.003" x2="745.218" y2="482.686" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="744.932" y1="508.319" x2="760.015" y2="485.008" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="761.027" y1="508.636" x2="774.813" y2="487.330" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="777.122" y1="508.953" x2="789.610" y2="489.653" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="793.217" y1="509.269" x2="804.407" y2="491.975" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="809.312" y1="509.586" x2="819.205" y2="494.297" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="825.407" y1="509.903" x2="834.002" y2="496.620" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="841.502" y1="510.219" x2="848.799" y2="498.942" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="857.597" y1="510.536" x2="863.597" y2="501.264" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <polygon points="512.000,932.000 444.000,556.000 512.000,512.000" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="miter" />
      <line x1="505.786" y1="616.171" x2="466.429" y2="641.637" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="506.102" y1="632.266" x2="468.751" y2="656.434" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="506.419" y1="648.361" x2="471.074" y2="671.232" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="506.736" y1="664.456" x2="473.396" y2="686.029" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="507.053" y1="680.551" x2="475.718" y2="700.826" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="507.369" y1="696.646" x2="478.041" y2="715.624" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="507.686" y1="712.741" x2="480.363" y2="730.421" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="508.003" y1="728.837" x2="482.686" y2="745.218" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="508.319" y1="744.932" x2="485.008" y2="760.015" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="508.636" y1="761.027" x2="487.330" y2="774.813" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="508.953" y1="777.122" x2="489.653" y2="789.610" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="509.269" y1="793.217" x2="491.975" y2="804.407" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="509.586" y1="809.312" x2="494.297" y2="819.205" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="509.903" y1="825.407" x2="496.620" y2="834.002" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="510.219" y1="841.502" x2="498.942" y2="848.799" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="510.536" y1="857.597" x2="501.264" y2="863.597" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <polygon points="92.000,512.000 468.000,444.000 512.000,512.000" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="miter" />
      <line x1="407.829" y1="505.786" x2="382.363" y2="466.429" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="391.734" y1="506.102" x2="367.566" y2="468.751" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="375.639" y1="506.419" x2="352.768" y2="471.074" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="359.544" y1="506.736" x2="337.971" y2="473.396" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="343.449" y1="507.053" x2="323.174" y2="475.718" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="327.354" y1="507.369" x2="308.376" y2="478.041" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="311.259" y1="507.686" x2="293.579" y2="480.363" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="295.163" y1="508.003" x2="278.782" y2="482.686" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="279.068" y1="508.319" x2="263.985" y2="485.008" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="262.973" y1="508.636" x2="249.187" y2="487.330" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="246.878" y1="508.953" x2="234.390" y2="489.653" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="230.783" y1="509.269" x2="219.593" y2="491.975" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="214.688" y1="509.586" x2="204.795" y2="494.297" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="198.593" y1="509.903" x2="189.998" y2="496.620" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="182.498" y1="510.219" x2="175.201" y2="498.942" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
      <line x1="166.403" y1="510.536" x2="160.403" y2="501.264" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
    </g>
  </g></g>
  <g id="center-hub" style="color:var(--compass-hub-color, var(--compass-color, currentColor))">
    <circle cx="512.000" cy="512.000" r="90.000" fill="none" stroke="currentColor" stroke-width="12" />
    <circle cx="512.000" cy="512.000" r="72.000" fill="none" stroke="currentColor" stroke-width="5" />
    <line x1="512.000" y1="455.000" x2="512.000" y2="445.000" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="524.684" y1="456.429" x2="526.464" y2="448.630" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="536.731" y1="460.645" x2="540.202" y2="453.437" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="547.539" y1="467.436" x2="552.527" y2="461.181" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="556.564" y1="476.461" x2="564.383" y2="470.226" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="563.355" y1="487.269" x2="570.563" y2="483.798" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="567.571" y1="499.316" x2="575.370" y2="497.536" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="569.000" y1="512.000" x2="577.000" y2="512.000" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="567.571" y1="524.684" x2="577.320" y2="526.909" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="563.355" y1="536.731" x2="570.563" y2="540.202" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="556.564" y1="547.539" x2="562.819" y2="552.527" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="547.539" y1="556.564" x2="552.527" y2="562.819" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="536.731" y1="563.355" x2="541.070" y2="572.365" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="524.684" y1="567.571" x2="526.464" y2="575.370" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="512.000" y1="569.000" x2="512.000" y2="577.000" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="499.316" y1="567.571" x2="497.536" y2="575.370" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="487.269" y1="563.355" x2="482.930" y2="572.365" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="476.461" y1="556.564" x2="471.473" y2="562.819" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="467.436" y1="547.539" x2="461.181" y2="552.527" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="460.645" y1="536.731" x2="453.437" y2="540.202" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="456.429" y1="524.684" x2="446.680" y2="526.909" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="455.000" y1="512.000" x2="447.000" y2="512.000" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="456.429" y1="499.316" x2="448.630" y2="497.536" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="460.645" y1="487.269" x2="453.437" y2="483.798" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="467.436" y1="476.461" x2="459.617" y2="470.226" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="476.461" y1="467.436" x2="471.473" y2="461.181" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="487.269" y1="460.645" x2="483.798" y2="453.437" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <line x1="499.316" y1="456.429" x2="497.536" y2="448.630" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
    <circle cx="512.000" cy="512.000" r="50.000" fill="none" stroke="currentColor" stroke-width="13" />
    <circle cx="512.000" cy="512.000" r="29.000" fill="none" stroke="currentColor" stroke-width="5" />
    <circle cx="512.000" cy="512.000" r="10.000" fill="currentColor" stroke="none" stroke-width="0" />
  </g>
  </svg>`;
export class VornanCompassLoader extends HTMLElement {
  static observedAttributes = ['label', 'decorative'];
  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).append(template.content.cloneNode(true));
  }
  connectedCallback() { this.updateAccessibility(); }
  attributeChangedCallback() { this.updateAccessibility(); }
  updateAccessibility() {
    if (this.hasAttribute('decorative')) {
      this.setAttribute('aria-hidden', 'true');
      this.removeAttribute('role');
      this.removeAttribute('aria-label');
    } else {
      this.removeAttribute('aria-hidden');
      this.setAttribute('role', 'status');
      this.setAttribute('aria-label', this.getAttribute('label') || 'Loading');
    }
  }
}
if (!customElements.get('vornan-compass-loader')) {
  customElements.define('vornan-compass-loader', VornanCompassLoader);
}
