import React, { useState } from 'react';
import { Download, Sparkles, Camera, FolderHeart, ArrowRight, Globe, X } from 'lucide-react';
import { API_BASE_URL } from '../utils/api';

export default function LandingPage() {
  const [activeDoc, setActiveDoc] = useState(null); // 'impressum', 'datenschutz', or null
  const apkDownloadUrl = `${API_BASE_URL}/api/app/latest-apk`;

  const handleOpenWebApp = () => {
    window.location.hash = '#/login';
  };

  return (
    <div className="fade-in landing-page-container" style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '80vh',
      padding: '1rem 0.5rem',
      maxWidth: '600px',
      margin: '0 auto',
      textAlign: 'center',
      position: 'relative'
    }}>
      {/* Glow background positioned absolutely behind everything */}
      <div style={{
        position: 'absolute',
        top: '60px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '280px',
        height: '280px',
        background: 'radial-gradient(circle, var(--primary-glow) 0%, transparent 70%)',
        zIndex: 0,
        pointerEvents: 'none',
        opacity: 0.6
      }}></div>

      {/* Logo */}
      <div style={{ position: 'relative', zIndex: 1, display: 'inline-block', marginBottom: '1.25rem' }}>
        <img 
          src="/favicon.svg" 
          alt="Vintamie Logo" 
          style={{ 
            width: '80px', 
            height: '80px', 
            borderRadius: '18px',
            border: '1px solid var(--glass-border)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 20px rgba(9, 176, 183, 0.15)'
          }} 
        />
      </div>

      {/* Hero Title */}
      <h1 style={{
        fontSize: '2.1rem',
        fontWeight: '800',
        fontFamily: 'var(--font-title)',
        lineHeight: '1.25',
        letterSpacing: '-0.02em',
        marginBottom: '1.25rem',
        position: 'relative',
        zIndex: 1,
        background: 'linear-gradient(135deg, var(--text-primary) 30%, var(--primary) 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        padding: '0 0.5rem'
      }}>
        Kleidung fotografieren, Anzeige fertig
      </h1>

      {/* Hero Description */}
      <p style={{
        fontSize: '1rem',
        color: 'var(--text-secondary)',
        lineHeight: '1.55',
        maxWidth: '520px',
        margin: '0 auto 2.25rem auto',
        position: 'relative',
        zIndex: 1,
        padding: '0 0.75rem'
      }}>
        Mache ein Foto deiner Kleidung. Vintamie erkennt automatisch Marke, Zustand sowie Farbe und schlägt dir den optimalen Preis vor. Danach kannst du deine Anzeige direkt bei Vinted und Kleinanzeigen einstellen.
      </p>

      {/* CTA Buttons */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.85rem',
        justifyContent: 'center',
        position: 'relative',
        zIndex: 1,
        width: '100%',
        padding: '0 1rem',
        marginBottom: '3.5rem'
      }}>
        {/* APK Download Button */}
        <a 
          href={apkDownloadUrl}
          download
          className="btn btn-primary"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem',
            padding: '0.9rem 1.75rem',
            fontSize: '0.95rem',
            fontWeight: '700',
            textDecoration: 'none',
            boxShadow: '0 8px 25px rgba(9, 176, 183, 0.35)',
            width: '100%',
            maxWidth: '290px',
            transition: 'transform 0.15s ease'
          }}
          onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
        >
          <Download size={16} />
          <span>App für Android laden</span>
        </a>

        {/* Web App Button */}
        <button 
          onClick={handleOpenWebApp}
          className="btn"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            padding: '0.8rem 1.5rem',
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid var(--glass-border)',
            color: 'var(--text-primary)',
            fontSize: '0.9rem',
            fontWeight: '600',
            cursor: 'pointer',
            width: '100%',
            maxWidth: '290px',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
            e.currentTarget.style.borderColor = 'rgba(9, 176, 183, 0.25)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
            e.currentTarget.style.borderColor = 'var(--glass-border)';
          }}
        >
          <Globe size={15} />
          <span>Im Browser starten</span>
          <ArrowRight size={13} style={{ marginLeft: '0.15rem' }} />
        </button>
      </div>

      {/* Features List (Unboxed, clean row) */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '2rem',
        width: '100%',
        padding: '0 1rem',
        textAlign: 'left'
      }}>
        {/* Feature 1 */}
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
          <div style={{
            width: '38px',
            height: '38px',
            borderRadius: '50%',
            background: 'rgba(9, 176, 183, 0.08)',
            border: '1px solid rgba(9, 176, 183, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--primary)',
            flexShrink: 0,
            marginTop: '0.25rem'
          }}>
            <Camera size={18} />
          </div>
          <div>
            <h3 style={{ fontSize: '1rem', fontFamily: 'var(--font-title)', fontWeight: '700', marginBottom: '0.25rem' }}>
              1. Foto machen
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.45' }}>
              Knipse ein Bild deines Kleidungsstücks oder wähle es aus deiner Galerie aus.
            </p>
          </div>
        </div>

        {/* Feature 2 */}
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
          <div style={{
            width: '38px',
            height: '38px',
            borderRadius: '50%',
            background: 'rgba(236, 72, 153, 0.08)',
            border: '1px solid rgba(236, 72, 153, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--secondary)',
            flexShrink: 0,
            marginTop: '0.25rem'
          }}>
            <Sparkles size={18} />
          </div>
          <div>
            <h3 style={{ fontSize: '1rem', fontFamily: 'var(--font-title)', fontWeight: '700', marginBottom: '0.25rem' }}>
              2. Automatische Erkennung
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.45' }}>
              Die integrierte Intelligenz erkennt Marke, Farbe und Zustand sekundenschnell.
            </p>
          </div>
        </div>

        {/* Feature 3 */}
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
          <div style={{
            width: '38px',
            height: '38px',
            borderRadius: '50%',
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--warning)',
            flexShrink: 0,
            marginTop: '0.25rem'
          }}>
            <FolderHeart size={18} />
          </div>
          <div>
            <h3 style={{ fontSize: '1rem', fontFamily: 'var(--font-title)', fontWeight: '700', marginBottom: '0.25rem' }}>
              3. Schnell online stellen
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.45' }}>
              Übertrage deine Entwürfe mit unserer Erweiterung direkt in die Formulare von Vinted und Kleinanzeigen.
            </p>
          </div>
        </div>
      </div>

      {/* Footer Legal Links */}
      <footer style={{
        marginTop: '5rem',
        paddingTop: '1.5rem',
        borderTop: '1px solid var(--glass-border)',
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '1.25rem',
        fontSize: '0.8rem',
        color: 'var(--text-muted)'
      }}>
        <button 
          onClick={() => setActiveDoc('impressum')}
          style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', textDecoration: 'underline', outline: 'none', padding: '0.25rem' }}
        >
          Impressum
        </button>
        <span style={{ opacity: 0.3 }}>&bull;</span>
        <button 
          onClick={() => setActiveDoc('datenschutz')}
          style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', textDecoration: 'underline', outline: 'none', padding: '0.25rem' }}
        >
          Datenschutz
        </button>
        <span style={{ opacity: 0.3 }}>&bull;</span>
        <span style={{ whiteSpace: 'nowrap' }}>Made with ❤️</span>
      </footer>

      {/* Legal Overlay Modal */}
      {activeDoc && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(7, 9, 13, 0.85)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
          boxSizing: 'border-box'
        }}>
          <div className="glass-panel" style={{
            width: '100%',
            maxWidth: '550px',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(9, 176, 183, 0.1)'
          }}>
            {/* Modal Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '1.25rem 1.5rem',
              borderBottom: '1px solid var(--glass-border)'
            }}>
              <h2 style={{
                fontSize: '1.2rem',
                fontFamily: 'var(--font-title)',
                fontWeight: '800',
                margin: 0,
                color: 'var(--text-primary)'
              }}>
                {activeDoc === 'impressum' ? 'Impressum' : 'Datenschutzerklärung'}
              </h2>
              <button 
                onClick={() => setActiveDoc(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0.25rem',
                  borderRadius: '50%',
                  transition: 'background 0.2s ease, color 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                  e.currentTarget.style.color = '#fff';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Content */}
            <div style={{
              padding: '1.5rem',
              overflowY: 'auto',
              textAlign: 'left',
              fontSize: '0.875rem',
              lineHeight: '1.6',
              color: 'var(--text-secondary)'
            }}>
              {activeDoc === 'impressum' ? (
                <div>
                  <h3 style={{ fontSize: '1rem', color: '#fff', marginBottom: '0.5rem', fontFamily: 'var(--font-title)' }}>
                    Angaben gemäß § 5 TMG
                  </h3>
                  <p style={{ marginBottom: '1.5rem' }}>
                    Henrik Heil<br />
                    Westendstraße 100<br />
                    60325 Frankfurt<br />
                    E-Mail: mail@henrikheil.net
                  </p>

                  <h3 style={{ fontSize: '1rem', color: '#fff', marginBottom: '0.5rem', fontFamily: 'var(--font-title)' }}>
                    Haftung für Inhalte
                  </h3>
                  <p style={{ marginBottom: '1.5rem' }}>
                    Als Diensteanbieter sind wir gemäß § 7 Abs.1 TMG für eigene Inhalte auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 TMG sind wir als Diensteanbieter jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige Tätigkeit hinweisen.
                  </p>

                  <h3 style={{ fontSize: '1rem', color: '#fff', marginBottom: '0.5rem', fontFamily: 'var(--font-title)' }}>
                    Haftung für Links
                  </h3>
                  <p style={{ marginBottom: '1.5rem' }}>
                    Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen. Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber der Seiten verantwortlich.
                  </p>

                  <h3 style={{ fontSize: '1rem', color: '#fff', marginBottom: '0.5rem', fontFamily: 'var(--font-title)' }}>
                    Urheberrecht
                  </h3>
                  <p>
                    Die durch die Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen dem deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art der Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen der schriftlichen Zustimmung des jeweiligen Autors bzw. Erstellers.
                  </p>
                </div>
              ) : (
                <div>
                  <h3 style={{ fontSize: '1rem', color: '#fff', marginBottom: '0.5rem', fontFamily: 'var(--font-title)' }}>
                    1. Datenschutz auf einen Blick
                  </h3>
                  <p style={{ marginBottom: '1.5rem' }}>
                    Der Schutz deiner persönlichen Daten hat für uns höchste Priorität. Diese Datenschutzerklärung informiert dich darüber, welche Daten wir erfassen und wie wir sie verwenden.
                  </p>

                  <h3 style={{ fontSize: '1rem', color: '#fff', marginBottom: '0.5rem', fontFamily: 'var(--font-title)' }}>
                    2. Datenerfassung auf dieser Website
                  </h3>
                  <p style={{ marginBottom: '1.25rem' }}>
                    <strong>Registrierungsdaten:</strong> Für die Nutzung unserer Entwurfs-Automatisierung erheben wir deine E-Mail-Adresse und ein verschlüsseltes Passwort. Diese Daten dienen ausschließlich zur Authentifizierung und Zuordnung deiner Entwürfe.
                  </p>
                  <p style={{ marginBottom: '1.5rem' }}>
                    <strong>Bilder und Entwürfe:</strong> Wenn du Fotos deiner Kleidung hochlädst, werden diese temporär zur Analyse an den Google Gemini API Dienst übertragen. Es werden keine Metadaten oder Standortdaten deiner Bilder dauerhaft gespeichert oder für Werbezwecke verwendet.
                  </p>

                  <h3 style={{ fontSize: '1rem', color: '#fff', marginBottom: '0.5rem', fontFamily: 'var(--font-title)' }}>
                    3. Weitergabe an Dritte
                  </h3>
                  <p style={{ marginBottom: '1.5rem' }}>
                    Deine Daten werden nicht an unbefugte Dritte weitergegeben. Zur Bildanalyse nutzen wir die Google Gemini API. Es werden hierbei ausschließlich die Bildinhalte übermittelt.
                  </p>

                  <h3 style={{ fontSize: '1rem', color: '#fff', marginBottom: '0.5rem', fontFamily: 'var(--font-title)' }}>
                    4. Deine Rechte
                  </h3>
                  <p>
                    Du hast jederzeit das Recht auf unentgeltliche Auskunft über Herkunft, Empfänger und Zweck deiner gespeicherten personenbezogenen Daten. Du hast außerdem ein Recht auf Berichtigung, Sperrung oder Löschung dieser Daten. Du kannst dein Konto und alle damit verbundenen Entwürfe und Bilder jederzeit direkt in deinen Profileinstellungen löschen.
                  </p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{
              display: 'flex',
              justifyContent: 'flex-end',
              padding: '1rem 1.5rem',
              borderTop: '1px solid var(--glass-border)',
              background: 'rgba(255, 255, 255, 0.01)'
            }}>
              <button 
                onClick={() => setActiveDoc(null)}
                className="btn btn-secondary"
                style={{
                  minHeight: '36px',
                  height: '36px',
                  padding: '0 1.25rem',
                  fontSize: '0.85rem'
                }}
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
