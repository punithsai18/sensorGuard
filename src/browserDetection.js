import { useState, useEffect } from 'react';

const DETECTED_BROWSERS_STATE = { current: [] };
const listeners = new Set();

export const ALL_BROWSERS_META = {
    chrome: { icon: '🟡', label: 'Chrome' },
    edge: { icon: '🔵', label: 'Edge' },
    firefox: { icon: '🦊', label: 'Firefox' },
    brave: { icon: '🦁', label: 'Brave' },
    opera: { icon: '⭕', label: 'Opera' },
    vivaldi: { icon: '🟢', label: 'Vivaldi' },
    arc: { icon: '🌈', label: 'Arc' },
};

let ws = null;
let reconnectTimeout = null;

function connect() {
    if (ws) return;
    ws = new WebSocket('ws://localhost:8999/browser-monitor');

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.event === 'detected_browsers') {
                const lowerBrowsers = data.browsers.map(b => b.toLowerCase());
                DETECTED_BROWSERS_STATE.current = lowerBrowsers;

                for (const listener of listeners) {
                    listener([...lowerBrowsers]);
                }
            }
        } catch (e) { }
    };

    ws.onclose = () => {
        ws = null;
        reconnectTimeout = setTimeout(connect, 2000);
    };
}

connect();

export function useDetectedBrowsers() {
    const [detected, setDetected] = useState(DETECTED_BROWSERS_STATE.current);

    useEffect(() => {
        setDetected(DETECTED_BROWSERS_STATE.current);
        const listener = (b) => setDetected(b);
        listeners.add(listener);
        return () => listeners.delete(listener);
    }, []);

    return detected;
}
