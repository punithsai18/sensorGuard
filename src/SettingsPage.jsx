import React, { useState, useEffect } from 'react';
import './App.css';

export default function SettingsPage() {
    const [config, setConfig] = useState(null);
    const [stats, setStats] = useState(null);
    const [showConsent, setShowConsent] = useState(false);
    const [loading, setLoading] = useState(true);

    // Mock functions to replicate actual backend behaviour in python for the UI
    const fetchConfig = async () => {
        try {
            // Ideally we'd fetch this from the backend
            // const resConfig = await fetch('/api/settings/config');
            // const resStats = await fetch('/api/settings/stats');
            // Mocking the backend state
            setConfig({
                permission_ledger_enabled: true,
                history_tamper_detection_enabled: false,
                differential_storage_enabled: false
            });
            setStats({
                permission_events_total: 14,
                snapshots_total: 0,
                undismissed_alerts: 0,
                db_size_kb: 12
            });
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchConfig();
    }, []);

    const toggleTamperDetection = () => {
        if (!config.history_tamper_detection_enabled) {
            setShowConsent(true);
        } else {
            setConfig({ ...config, history_tamper_detection_enabled: false, differential_storage_enabled: false });
            // API call to update config
        }
    };

    const confirmConsent = () => {
        setConfig({ ...config, history_tamper_detection_enabled: true });
        setShowConsent(false);
        // API call to save config
    };

    const clearAllData = () => {
        if (window.confirm("Are you sure you want to clear all forensic data? This cannot be undone.")) {
            // API call to wipe data
            setStats({
                permission_events_total: 0,
                snapshots_total: 0,
                undismissed_alerts: 0,
                db_size_kb: 0
            });
            alert("All forensic data has been cleared.");
        }
    };

    if (loading || !config || !stats) return <div style={{ padding: '2rem', color: '#fff' }}>Loading settings...</div>;

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem', color: '#fff' }}>
            <h2 style={{ marginBottom: '1.5rem', fontWeight: 600, color: 'var(--color-primary)' }}>Privacy &amp; Forensic Settings</h2>

            <div style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '8px',
                padding: '1.5rem',
                marginBottom: '1.5rem'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                    <div style={{ fontWeight: 500, fontSize: '1.1rem' }}>Permission Monitoring</div>
                    <div style={{ color: 'var(--color-primary)', fontWeight: 'bold' }}>● Always On</div>
                </div>
                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', lineHeight: 1.5 }}>
                    Logs when browser permission grants or revocations occur.<br />Raw URLs are never stored.
                </div>
            </div>

            <div style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '8px',
                padding: '1.5rem',
                marginBottom: '1.5rem'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                    <div style={{ fontWeight: 500, fontSize: '1.1rem' }}>History Tamper Detection</div>
                    <button
                        onClick={toggleTamperDetection}
                        style={{
                            background: config.history_tamper_detection_enabled ? 'var(--color-primary)' : 'rgba(255, 255, 255, 0.1)',
                            color: config.history_tamper_detection_enabled ? '#000' : '#fff',
                            border: 'none',
                            padding: '0.3rem 0.8rem',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontWeight: 'bold'
                        }}
                    >
                        {config.history_tamper_detection_enabled ? '● ON' : '○ Off [Turn On]'}
                    </button>
                </div>
                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', lineHeight: 1.5 }}>
                    Detects if browser history is suddenly deleted or modified by a background process.<br />
                    Stores only hashed domain fingerprints — never actual URLs.
                </div>
            </div>

            <div style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '8px',
                padding: '1.5rem'
            }}>
                <div style={{ fontWeight: 500, fontSize: '1.1rem', marginBottom: '1rem' }}>Forensic Data Storage</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, max-content) 1fr', gap: '0.5rem', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                    <div style={{ color: 'var(--color-text-muted)' }}>Permission events:</div>
                    <div>{stats.permission_events_total} records</div>

                    <div style={{ color: 'var(--color-text-muted)' }}>History snapshots:</div>
                    <div>{stats.snapshots_total} records</div>

                    <div style={{ color: 'var(--color-text-muted)' }}>Tamper alerts:</div>
                    <div>{stats.undismissed_alerts} records</div>

                    <div style={{ color: 'var(--color-text-muted)' }}>Database size:</div>
                    <div>{stats.db_size_kb} KB</div>
                </div>

                <button
                    onClick={clearAllData}
                    style={{
                        background: 'transparent',
                        color: '#ff4d4f',
                        border: '1px solid #ff4d4f',
                        padding: '0.5rem 1rem',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '0.9rem'
                    }}
                >
                    Clear All Forensic Data
                </button>
                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', marginTop: '0.5rem' }}>This cannot be undone.</div>
            </div>

            {/* Consent Modal Overlay */}
            {showConsent && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.8)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 9999
                }}>
                    <div style={{
                        background: '#1a1a1a',
                        border: '1px solid #333',
                        borderRadius: '8px',
                        width: '100%', maxWidth: '500px',
                        padding: '2rem',
                    }}>
                        <h3 style={{ color: '#ffcc00', marginTop: 0, marginBottom: '1rem' }}>⚠ Before you enable this</h3>
                        <p style={{ fontSize: '0.9rem', lineHeight: 1.5, marginBottom: '1rem' }}>
                            History Tamper Detection stores a cryptographic fingerprint of your browser history every 60 seconds.
                        </p>

                        <div style={{ background: 'rgba(255, 255, 255, 0.05)', padding: '1rem', borderRadius: '4px', marginBottom: '1rem', fontSize: '0.9rem' }}>
                            <div style={{ fontWeight: 'bold', marginBottom: '0.5rem', color: '#4caf50' }}>What IS stored:</div>
                            <ul style={{ margin: 0, paddingLeft: '1.5rem', color: 'var(--color-text-muted)' }}>
                                <li>Number of history entries</li>
                                <li>A one-way hash of visited domains</li>
                                <li>Whether history changed between scans</li>
                            </ul>
                        </div>

                        <div style={{ background: 'rgba(255, 255, 255, 0.05)', padding: '1rem', borderRadius: '4px', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                            <div style={{ fontWeight: 'bold', marginBottom: '0.5rem', color: '#ff4d4d' }}>What is NEVER stored:</div>
                            <ul style={{ margin: 0, paddingLeft: '1.5rem', color: 'var(--color-text-muted)' }}>
                                <li>URLs you visited</li>
                                <li>Page titles or content</li>
                                <li>Anything readable from your history</li>
                            </ul>
                        </div>

                        <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1.5rem', fontStyle: 'italic' }}>
                            All data is stored only on this device and automatically deleted after 30 days.
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                            <button
                                onClick={() => setShowConsent(false)}
                                style={{ background: 'transparent', color: '#fff', border: '1px solid #555', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer' }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmConsent}
                                style={{ background: 'var(--color-primary)', color: '#000', border: 'none', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                            >
                                Enable Protection
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
