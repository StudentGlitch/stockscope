'use client';

import React, { useEffect, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions
} from 'chart.js';
import { Chart } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend
);

interface StockChartOverlayProps {
  ticker: string;
}

export const StockChartOverlay: React.FC<StockChartOverlayProps> = ({ ticker }) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const res = await fetch(`/api/indicators/${ticker}`);
        if (!res.ok) throw new Error('Failed to fetch data');
        const json = await res.json();
        setData(json);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [ticker]);

  if (loading) return <div className="p-4 text-center">Loading chart data...</div>;
  if (error) return <div className="p-4 text-center text-red-500">Error: {error}</div>;
  if (!data) return null;

  const chartData = {
    labels: data.labels,
    datasets: [
      {
        type: 'line' as const,
        label: 'Price',
        data: data.datasets.price,
        borderColor: 'rgba(75, 192, 192, 1)',
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        yAxisID: 'y'
      },
      {
        type: 'line' as const,
        label: 'RSI (14)',
        data: data.datasets.rsi,
        borderColor: 'rgba(153, 102, 255, 1)',
        backgroundColor: 'rgba(153, 102, 255, 0.2)',
        yAxisID: 'y1'
      },
      {
        type: 'bar' as const,
        label: 'MACD Histogram',
        data: data.datasets.macd.histogram,
        backgroundColor: (ctx: any) => {
           const val = ctx.raw;
           return val && val < 0 ? 'rgba(255, 99, 132, 0.5)' : 'rgba(75, 192, 192, 0.5)';
        },
        yAxisID: 'y2'
      }
    ]
  };

  const options: ChartOptions = {
    responsive: true,
    interaction: {
      mode: 'index',
      intersect: false,
    },

    plugins: {
      title: {
        display: true,
        text: `${ticker} Price, RSI & MACD`
      }
    },
    scales: {
      y: {
        type: 'linear',
        display: true,
        position: 'left',
        title: { display: true, text: 'Price (IDR)' }
      },
      y1: {
        type: 'linear',
        display: true,
        position: 'right',
        min: 0,
        max: 100,
        grid: { drawOnChartArea: false },
        title: { display: true, text: 'RSI' }
      },
      y2: {
        type: 'linear',
        display: true,
        position: 'right',
        grid: { drawOnChartArea: false },
        title: { display: true, text: 'MACD' }
      }
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-5xl mx-auto p-4 bg-slate-900 rounded-xl shadow-lg border border-slate-800">
      <div className="relative h-96 w-full">
        <Chart type="line" data={chartData} options={options} />
      </div>
      
      {/* Fundamentals Display */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
        <div className="p-4 bg-slate-800 rounded-lg">
          <p className="text-sm text-slate-400">P/E Ratio</p>
          <p className="text-xl font-bold text-white">{data.fundamentals?.pe?.toFixed(2) || 'N/A'}</p>
        </div>
        <div className="p-4 bg-slate-800 rounded-lg">
          <p className="text-sm text-slate-400">P/B Ratio</p>
          <p className="text-xl font-bold text-white">{data.fundamentals?.pb?.toFixed(2) || 'N/A'}</p>
        </div>
        <div className="p-4 bg-slate-800 rounded-lg relative overflow-hidden group">
          <p className="text-sm text-amber-400 font-medium">EV/EBITDA (Premium)</p>
          {data.fundamentals?.premiumRequired ? (
              <div className="flex items-center gap-2 mt-1">
                 <span className="text-xl font-bold text-slate-600 blur-[4px] select-none">12.5</span>
                 <span className="text-xs bg-amber-500 text-black px-2 py-1 rounded font-bold">PRO</span>
              </div>
          ) : (
             <p className="text-xl font-bold text-white">{data.fundamentals?.evEbitda?.toFixed(2) || 'N/A'}</p>
          )}
        </div>
        <div className="p-4 bg-slate-800 rounded-lg">
           <p className="text-sm text-slate-400">Market Cap</p>
           <p className="text-xl font-bold text-white">
             {data.fundamentals?.marketCap ? `Rp ${(data.fundamentals.marketCap / 1e12).toFixed(1)}T` : 'N/A'}
           </p>
        </div>
      </div>
    </div>
  );
};
