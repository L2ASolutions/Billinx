'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { formatCurrency } from '@/lib/utils';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  Sector,
  type PieSectorDataItem,
  type TooltipContentProps,
  type BarRectangleItem,
} from 'recharts';
import type { ValueType, NameType } from 'recharts/types/component/DefaultTooltipContent';
import { Sk } from './Sk';
import type { ChartData } from './types';

function formatYAxis(value: number): string {
  if (value >= 1_000_000) return `₦${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `₦${(value / 1_000).toFixed(0)}K`;
  return `₦${value}`;
}

const STATUS_COLORS: Record<string, string> = {
  Paid: '#1D9E75',
  Accepted: '#86EFAC',
  Overdue: '#EF4444',
  'Needs attention': '#F59E0B',
  Draft: '#9CA3AF',
  Cancelled: '#E5E7EB',
};

function RevenueTooltip({ active, payload, label }: TooltipContentProps<ValueType, NameType>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-border rounded-xl shadow-lg px-4 py-3 text-xs space-y-1">
      <p className="font-semibold text-dark mb-1">{label}</p>
      <p className="text-muted">
        Revenue:{' '}
        <span className="font-semibold text-dark">{formatCurrency(Number(payload[0].value), 'NGN')}</span>
      </p>
      <p className="text-[#1D9E75] text-[10px] mt-1">Click to view invoices →</p>
    </div>
  );
}

function ActivityTooltip({ active, payload, label }: TooltipContentProps<ValueType, NameType>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-border rounded-xl shadow-lg px-4 py-3 text-xs space-y-1">
      <p className="font-semibold text-dark mb-1.5">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: entry.color }} />
          <span className="text-muted capitalize">{entry.name}:</span>
          <span className="font-medium text-dark">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

function activeDonutShape(props: PieSectorDataItem) {
  const { cx = 0, cy = 0, innerRadius = 0, outerRadius = 0, startAngle = 0, endAngle = 0, fill } = props;
  return (
    <Sector
      cx={cx as number}
      cy={cy as number}
      innerRadius={innerRadius as number}
      outerRadius={(outerRadius as number) + 6}
      startAngle={startAngle as number}
      endAngle={endAngle as number}
      fill={fill}
    />
  );
}

interface DashboardChartsProps {
  chartsLoading: boolean;
  chartData: ChartData | null;
  showRevenueChart: boolean;
  showPipelineChart: boolean;
  showActivityChart: boolean;
}

export function DashboardCharts({
  chartsLoading,
  chartData,
  showRevenueChart,
  showPipelineChart,
  showActivityChart,
}: DashboardChartsProps) {
  const router = useRouter();

  const anyChartVisible = showRevenueChart || showPipelineChart || showActivityChart;
  const visibleChartCount = [showRevenueChart, showPipelineChart, showActivityChart].filter(Boolean).length;

  const noChartData =
    !chartData ||
    (chartData.revenueTrend.every((d) => d.amount === 0) &&
      chartData.invoiceStatusBreakdown.every((d) => d.count === 0) &&
      chartData.sentVsReceived.every((d) => d.sent === 0 && d.received === 0));

  if (!anyChartVisible) return null;

  if (chartsLoading) {
    return (
      <div className={`grid gap-4 ${visibleChartCount === 3 ? 'grid-cols-3' : visibleChartCount === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {Array.from({ length: visibleChartCount }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-border shadow-card p-5">
            <Sk className="h-4 w-36 mb-1" />
            <Sk className="h-3 w-48 mb-4" />
            <Sk className="h-[220px] w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (noChartData) {
    return (
      <div className="bg-white rounded-xl border border-border shadow-card p-10 flex flex-col items-center gap-3 text-center">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.5" className="text-gray-300">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="9" y1="15" x2="15" y2="15" />
        </svg>
        <div>
          <p className="font-semibold text-dark">No invoice data yet</p>
          <p className="text-sm text-muted mt-0.5">Create your first invoice to start seeing trends</p>
        </div>
        <Link href="/invoices/new">
          <Button size="sm" className="mt-1">+ Create invoice</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className={`grid gap-4 ${visibleChartCount === 3 ? 'grid-cols-3' : visibleChartCount === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {/* Chart 1 — Monthly Revenue (financial, OWNER/ADMIN/ACCOUNTANT only) */}
      {showRevenueChart && chartData && (
        <div className="bg-white rounded-xl border border-border shadow-card p-5">
          <h2 className="font-semibold text-dark">Monthly Revenue</h2>
          <p className="text-xs text-muted mt-0.5 mb-4">
            Accepted invoices — last 6 months. Click a bar to view that month&apos;s invoices.
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={chartData.revenueTrend}
              margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
              style={{ cursor: 'pointer' }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={formatYAxis}
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                axisLine={false}
                tickLine={false}
                width={60}
              />
              <Tooltip content={RevenueTooltip} cursor={{ fill: 'rgba(29,158,117,0.06)' }} />
              <Bar
                dataKey="amount"
                name="Revenue"
                fill="#1D9E75"
                radius={[4, 4, 0, 0]}
                maxBarSize={48}
                cursor="pointer"
                onClick={(data: BarRectangleItem) => {
                  const monthKey = (data as unknown as { monthKey?: string }).monthKey;
                  router.push(`/invoices?direction=sent&month=${monthKey}`);
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Chart 2 — Invoice Pipeline */}
      {showPipelineChart && chartData && (
        <div className="bg-white rounded-xl border border-border shadow-card p-5 min-w-0">
          <h2 className="font-semibold text-dark">Invoice Pipeline</h2>
          <p className="text-xs text-muted mt-0.5 mb-4">
            Current status of all sent invoices. Click a segment to view those invoices.
          </p>
          {(() => {
            const nonZero = chartData.invoiceStatusBreakdown.filter((d) => d.count > 0);
            const total = chartData.invoiceStatusBreakdown.reduce((s, d) => s + d.count, 0);
            const filterMap: Record<string, string> = {
              Paid: 'paid',
              Accepted: 'accepted',
              Overdue: 'overdue',
              'Needs attention': 'needs-attention',
              Draft: 'draft',
              Cancelled: 'cancelled',
            };
            return (
              <div className="flex flex-col items-center gap-3">
                <div style={{ width: '100%', height: 180 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={nonZero}
                        dataKey="count"
                        nameKey="status"
                        cx="50%"
                        cy="50%"
                        innerRadius={68}
                        outerRadius={90}
                        paddingAngle={2}
                        activeShape={activeDonutShape}
                        cursor="pointer"
                        onClick={(_: unknown, index: number) => {
                          const seg = nonZero[index];
                          if (seg) router.push(`/invoices?direction=sent&filter=${filterMap[seg.status] ?? ''}`);
                        }}
                      >
                        {nonZero.map((entry) => (
                          <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? '#9CA3AF'} />
                        ))}
                      </Pie>
                      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle">
                        <tspan x="50%" dy="-6" fontSize="22" fontWeight="700" fill="#111827">{total}</tspan>
                        <tspan x="50%" dy="18" fontSize="10" fill="#9ca3af">invoices</tspan>
                      </text>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-col gap-1.5 w-full">
                  {chartData.invoiceStatusBreakdown.map((d) => (
                    <button
                      key={d.status}
                      onClick={() => router.push(`/invoices?direction=sent&filter=${filterMap[d.status] ?? ''}`)}
                      className="flex items-center gap-2 text-left hover:bg-gray-50 rounded px-1 py-0.5 transition-colors"
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: STATUS_COLORS[d.status] ?? '#9CA3AF' }} />
                      <span className="text-xs text-muted flex-1 truncate">{d.status}</span>
                      <span className="text-xs font-semibold text-dark tabular-nums">{d.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Chart 3 — Invoice Activity */}
      {showActivityChart && chartData && (
        <div className="bg-white rounded-xl border border-border shadow-card p-5">
          <h2 className="font-semibold text-dark">Invoice Activity</h2>
          <p className="text-xs text-muted mt-0.5 mb-4">
            Invoices sent and received — last 6 months
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={chartData.sentVsReceived}
              margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                axisLine={false}
                tickLine={false}
                width={32}
              />
              <Tooltip content={ActivityTooltip} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
              <Legend
                wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
                iconType="circle"
                iconSize={8}
              />
              <Bar dataKey="sent" name="Sent" fill="#1D9E75" radius={[4, 4, 0, 0]} maxBarSize={32} />
              <Bar dataKey="received" name="Received" fill="#93C5FD" radius={[4, 4, 0, 0]} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
