import { useState, type ComponentType } from 'react';
import {
  Brain,
  Grid3x3,
  Calculator,
  Layers,
  ArrowLeft,
  ListOrdered,
  AlertTriangle,
} from 'lucide-react';
import Wordle from '@/games/Wordle';
import Sudoku from '@/games/Sudoku';
import Game2048 from '@/games/Game2048';
import ChessGame from '@/games/ChessBoard';
import Solitaire from '@/games/Solitaire';
import Minesweeper from '@/games/Minesweeper';

interface Exercise {
  id: 'wordle' | 'sudoku' | '2048' | 'chess' | 'solitaire' | 'minesweeper';
  label: string;
  category: string;
  description: string;
  cleCredits: string;
  Icon: typeof Brain;
  Component: ComponentType;
}

const EXERCISES: ReadonlyArray<Exercise> = [
  {
    id: 'wordle',
    label: 'Term Identifier',
    category: 'Daily Drill',
    description:
      'Identify the operative legal term in six attempts. Refreshes daily for ongoing competency.',
    cleCredits: '0.25 CLE',
    Icon: Brain,
    Component: Wordle,
  },
  {
    id: 'sudoku',
    label: 'Logical Reasoning Drill',
    category: 'Skill Module',
    description:
      'Constraint-satisfaction exercise drawn from formal logic methodology. Multiple difficulty tiers.',
    cleCredits: '0.50 CLE',
    Icon: Grid3x3,
    Component: Sudoku,
  },
  {
    id: '2048',
    label: 'Settlement Calculator',
    category: 'Negotiation Lab',
    description:
      'Iterative valuation exercise. Combine equivalent positions to reach the threshold figure.',
    cleCredits: '0.25 CLE',
    Icon: Calculator,
    Component: Game2048,
  },
  {
    id: 'chess',
    label: 'Strategic Reasoning Module',
    category: 'Advocacy Practicum',
    description:
      'Two-player tabletop simulation focused on positional reasoning and adversarial planning.',
    cleCredits: '1.00 CLE',
    Icon: Layers,
    Component: ChessGame,
  },
  {
    id: 'solitaire',
    label: 'Chronological Sequencing Drill',
    category: 'Records Management',
    description:
      'File each instrument of the record in strict sequence across four registers. Session resumes where you left off.',
    cleCredits: '0.50 CLE',
    Icon: ListOrdered,
    Component: Solitaire,
  },
  {
    id: 'minesweeper',
    label: 'Risk Assessment Matrix',
    category: 'Due Diligence Lab',
    description:
      'Survey the engagement grid and isolate undisclosed liabilities from adjacency disclosures. Three exposure tiers.',
    cleCredits: '0.75 CLE',
    Icon: AlertTriangle,
    Component: Minesweeper,
  },
];

export default function CompliancePage() {
  const [activeId, setActiveId] = useState<Exercise['id'] | null>(null);
  const active = EXERCISES.find((e) => e.id === activeId) ?? null;

  if (active) {
    const Body = active.Component;
    return (
      <div className="flex-1 flex flex-col bg-cream overflow-hidden">
        <div className="border-b border-border bg-white px-6 py-3 flex items-center justify-between flex-shrink-0">
          <button
            onClick={() => setActiveId(null)}
            className="flex items-center gap-1.5 text-xs font-sans text-blue-600 hover:underline"
          >
            <ArrowLeft className="w-3 h-3" />
            All Exercises
          </button>
          <span className="text-[10px] font-mono text-text-muted">
            {active.category} · {active.cleCredits}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto">
          <Body />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-cream overflow-hidden">
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-3xl mx-auto">
          <div className="mb-6 pb-4 border-b border-border text-center">
            <p className="text-[10px] font-serif uppercase tracking-[0.2em] text-navy/60 mb-1">
              CIRCUITUS COMPLIANCE &amp; CONTINUING EDUCATION
            </p>
            <h1 className="font-serif text-lg font-bold text-navy">
              Diligence Exercises
            </h1>
            <p className="text-[10px] font-mono text-text-muted mt-1">
              Approved competency drills. Completion logs to your Compliance Transcript.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {EXERCISES.map((e) => (
              <button
                key={e.id}
                onClick={() => setActiveId(e.id)}
                className="text-left bg-white border border-border rounded p-4 hover:border-gold/50 hover:shadow-sm transition-all"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded bg-navy/5 flex items-center justify-center">
                    <e.Icon className="w-4 h-4 text-navy" />
                  </div>
                  <div>
                    <p className="text-[9px] font-sans uppercase tracking-wider text-text-muted">
                      {e.category}
                    </p>
                    <p className="font-serif text-base font-bold text-navy leading-tight">
                      {e.label}
                    </p>
                  </div>
                </div>
                <p className="text-[11px] font-sans text-text-muted leading-snug mb-2">
                  {e.description}
                </p>
                <p className="text-[9px] font-mono text-gold">{e.cleCredits}</p>
              </button>
            ))}
          </div>

          <p className="text-[10px] font-mono text-text-muted/60 text-center mt-6">
            Activity is logged locally. No completion data is transmitted.
          </p>
        </div>
      </div>
    </div>
  );
}
