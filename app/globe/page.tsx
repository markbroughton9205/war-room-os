import type { Metadata } from 'next'


export const metadata: Metadata = {
  title: 'War Room — Higher Vision Inc',
  description: "Ra'el Sovereign Intelligence Platform",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-black">
        {children}
        <div id="wand-tip" />
        <canvas
          id="wand-trail"
          suppressHydrationWarning
          style={{
            position:'fixed',
            top:0,
            left:0,
            pointerEvents:'none',
            zIndex:99997
          }}
        />
        <script dangerouslySetInnerHTML={{__html:`
          (function() {
            var tip = document.getElementById('wand-tip');
            var canvas = document.getElementById('wand-trail');
            var ctx = canvas.getContext('2d');
            function resize() {
              canvas.width = window.innerWidth;
              canvas.height = window.innerHeight;
            }
            resize();
            window.addEventListener('resize', resize);
            var trail = [];
            document.addEventListener('mousemove', function(e) {
              tip.style.left = e.clientX + 'px';
              tip.style.top = e.clientY + 'px';
              trail.push({x: e.clientX, y: e.clientY});
              if (trail.length > 40) trail.shift();
            });
            function drawTrail() {
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              for (var i = 0; i < trail.length; i++) {
                var alpha = (i / trail.length) * 0.6;
                var size = (i / trail.length) * 4;
                ctx.beginPath();
                ctx.arc(trail[i].x, trail[i].y, size, 0, Math.PI * 2);
                ctx.fillStyle = i % 3 === 0
                  ? 'rgba(255,215,0,' + alpha + ')'
                  : 'rgba(0,255,65,' + alpha + ')';
                ctx.fill();
              }
              requestAnimationFrame(drawTrail);
            }
            drawTrail();
          })();
        `}} />
      </body>
    </html>
  )
}