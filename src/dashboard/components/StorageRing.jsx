import React, { useState, useEffect } from 'react';
import { getStorageUsage, getSetting } from '../bridge.js';

export default function StorageRing({ storageInfo: externalInfo }) {
  const [info, setInfo] = useState(externalInfo || null);
  const [loading, setLoading] = useState(!externalInfo);
  const [storageLimitMb, setStorageLimitMb] = useState(500);

  useEffect(() => {
    (async () => {
      try {
        const res = await getSetting('storage_limit_mb');
        if (res.success && res.value) {
          const val = parseInt(res.value, 10);
          if (!isNaN(val)) {
            setStorageLimitMb(val);
          }
        }
      } catch (err) {
        console.error('[Synapse] Failed to fetch storage_limit_mb:', err);
      }
    })();
  }, []);

  useEffect(() => {
    if (externalInfo) {
      setInfo(externalInfo);
      setLoading(false);
      return;
    }
    (async () => {
      try {
        setLoading(true);
        const res = await getStorageUsage();
        if (res.success) setInfo(res);
      } catch (e) {
        console.error('[Synapse] StorageRing fetch error:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [externalInfo]);

  if (loading || !info) {
    return (
      <div className="synapse-storage">
        <div className="synapse-loading-center" style={{ height: 120 }}>
          <div className="synapse-spinner" />
        </div>
      </div>
    );
  }

  const usedMB = parseFloat(info.totalMB || '0');
  const pct = Math.min(100, (usedMB / storageLimitMb) * 100);
  const pctDisplay = pct.toFixed(1);

  // SVG ring parameters
  const size = 120;
  const strokeWidth = 10;
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (pct / 100) * circumference;

  // Color by usage
  const ringColor = pct < 50 ? '#10b981' : pct < 80 ? '#f59e0b' : '#ef4444';

  return (
    <div className="synapse-storage synapse-storage__ring-wrap">
      {/* SVG Ring */}
      <div className="synapse-storage__ring">
        <svg width={size} height={size}>
          {/* Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="rgba(255,255,255,0.05)"
            strokeWidth={strokeWidth}
          />
          {/* Progress */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={ringColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.8s ease, stroke 0.3s ease' }}
          />
          {/* Glow filter */}
          <defs>
            <filter id="ringGlow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
        </svg>
        <div className="synapse-storage__ring-center">
          <div className="synapse-storage__ring-pct" style={{ color: ringColor }}>
            {pctDisplay}%
          </div>
          <div className="synapse-storage__ring-label">used</div>
        </div>
      </div>

      {/* Stats */}
      <div className="synapse-storage__stats">
        <div className="synapse-storage__stat-row">
          <span className="synapse-storage__stat-label">Used</span>
          <span className="synapse-storage__stat-value">{usedMB} MB</span>
        </div>
        <div className="synapse-storage__stat-row">
          <span className="synapse-storage__stat-label">Limit</span>
          <span className="synapse-storage__stat-value">{storageLimitMb} MB</span>
        </div>
        <div className="synapse-storage__stat-row">
          <span className="synapse-storage__stat-label">Capsules</span>
          <span className="synapse-storage__stat-value">{info.capsuleCount ?? 0}</span>
        </div>
        <div className="synapse-storage__stat-row">
          <span className="synapse-storage__stat-label">Chunks</span>
          <span className="synapse-storage__stat-value">{info.chunkCount ?? 0}</span>
        </div>
        <div className="synapse-storage__stat-row">
          <span className="synapse-storage__stat-label">Free</span>
          <span className="synapse-storage__stat-value" style={{ color: 'var(--success)' }}>
            {(storageLimitMb - usedMB).toFixed(2)} MB
          </span>
        </div>
      </div>
    </div>
  );
}
