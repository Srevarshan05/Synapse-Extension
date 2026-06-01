import React from 'react';
import { Archive, Database, Cpu, TrendingUp, ArrowRight, Pin } from 'lucide-react';
import StorageRing from './StorageRing.jsx';
import { PLATFORM_COLORS, PLATFORM_NAMES, PLATFORM_EMOJI } from '../App.jsx';

function formatTimeAgo(ms) {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function StatCard({ icon: Icon, label, value, delta, color = 'var(--accent)' }) {
  return (
    <div className="synapse-card synapse-stat-card">
      <div className="synapse-stat-card__icon" style={{ background: color + '18', borderColor: color + '40' }}>
        <Icon size={20} color={color} strokeWidth={2} />
      </div>
      <div>
        <div className="synapse-stat-card__label">{label}</div>
        <div className="synapse-stat-card__value">{value}</div>
        {delta && <div className="synapse-stat-card__delta">{delta}</div>}
      </div>
    </div>
  );
}

function RecentItem({ capsule }) {
  const color = PLATFORM_COLORS[capsule.platform] || '#8b5cf6';
  const emoji = PLATFORM_EMOJI[capsule.platform] || '🤖';
  return (
    <div className="synapse-recent-item" style={{ cursor: 'default' }}>
      <div className="synapse-recent-item__icon" style={{ background: color + '18', borderColor: color + '30' }}>
        <span>{emoji}</span>
      </div>
      <div className="synapse-recent-item__info">
        <div className="synapse-recent-item__title">{capsule.title}</div>
        <div className="synapse-recent-item__meta">
          {PLATFORM_NAMES[capsule.platform] || capsule.platform} · {capsule.captureLevel}
          {capsule.pinned && <span style={{ color: 'var(--accent)', marginLeft: 6 }}>📌</span>}
        </div>
      </div>
      <div className="synapse-recent-item__time">{formatTimeAgo(capsule.createdAt)}</div>
    </div>
  );
}

export default function Overview({ capsules, storageInfo, loading, onNavigate, onDelete, onPin, onView }) {
  // Derive stats
  const pinnedCount = capsules.filter(c => c.pinned).length;
  const platforms = [...new Set(capsules.map(c => c.platform))].length;
  const avgCompleteness = capsules.length
    ? Math.round(capsules.reduce((sum, c) => sum + (c.captureReport?.completeness || 0), 0) / capsules.length)
    : 0;

  const recentSynapses = [...capsules]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 6);

  if (loading) {
    return (
      <div className="synapse-loading-center">
        <div className="synapse-spinner synapse-spinner--lg" />
      </div>
    );
  }

  return (
    <div>
      {/* Page header */}
      <div className="synapse-page-header">
        <div className="synapse-page-header__title">Dashboard Overview</div>
        <div className="synapse-page-header__sub">Your LLM context continuity at a glance</div>
      </div>

      {/* Stat cards */}
      <div className="synapse-overview__grid">
        <StatCard
          icon={Archive}
          label="Total Synapses"
          value={capsules.length}
          color="var(--accent)"
        />
        <StatCard
          icon={Pin}
          label="Pinned"
          value={pinnedCount}
          color="#f59e0b"
        />
        <StatCard
          icon={Cpu}
          label="Platforms"
          value={platforms}
          color="#10b981"
        />
        <StatCard
          icon={TrendingUp}
          label="Avg. Completeness"
          value={capsules.length ? `${avgCompleteness}%` : '—'}
          color="#4285f4"
        />
      </div>

      {/* Lower grid */}
      <div className="synapse-overview__lower">
        {/* Recent synapses */}
        <div className="synapse-card synapse-overview__recent">
          <div className="synapse-overview__recent-title">
            <span>Recent Synapses</span>
            {capsules.length > 0 && (
              <button
                className="synapse-link-btn"
                onClick={() => onNavigate('capsules')}
                style={{ display: 'flex', alignItems: 'center', gap: 4 }}
              >
                View all <ArrowRight size={13} />
              </button>
            )}
          </div>

          {recentSynapses.length === 0 ? (
            <div className="synapse-empty" style={{ padding: '40px 16px' }}>
              <div className="synapse-empty__icon">
                <Archive size={28} color="var(--accent)" />
              </div>
              <div className="synapse-empty__title">No synapses yet</div>
              <div className="synapse-empty__sub">
                Open a supported LLM and click Smart Copy to capture
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
               {recentSynapses.map(capsule => (
                <RecentItem
                  key={capsule.id}
                  capsule={capsule}
                />
              ))}
            </div>
          )}
        </div>

        {/* Storage */}
        <div className="synapse-card synapse-overview__storage">
          <div className="synapse-storage__title" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Database size={16} color="var(--accent)" />
            Storage Usage
          </div>
          <StorageRing storageInfo={storageInfo} />
        </div>
      </div>
    </div>
  );
}
