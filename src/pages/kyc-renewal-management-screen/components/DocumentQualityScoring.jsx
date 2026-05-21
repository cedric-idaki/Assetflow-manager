import React, { useState, useEffect, useCallback } from 'react';
import Icon from '../../../components/AppIcon';
import { useChat } from '../../../hooks/useChat';
import toast from 'react-hot-toast';

const SCORE_SYSTEM_PROMPT = `You are a KYC document quality analyst. When given a document description or URL, analyze it and return ONLY a valid JSON object with this exact structure:
{
  "overallScore": <number 0-100>,
  "clarity": <number 0-100>,
  "completeness": <number 0-100>,
  "authenticity": <number 0-100>,
  "issues": [<string>, ...],
  "recommendation": "approve" | "flag" | "reject",
  "summary": "<one sentence summary>"
}
Scoring guide:
- clarity: Is the document image clear, readable, not blurry or obscured?
- completeness: Are all required fields visible (name, ID number, dates, photo)?
- authenticity: Are there signs of tampering, inconsistencies, or suspicious elements?
- overallScore: Weighted average (clarity 30%, completeness 40%, authenticity 30%)
- recommendation: approve if overallScore>=75, flag if 50-74, reject if <50
Return ONLY the JSON, no markdown, no explanation.`;

const getScoreColor = (score) => {
  if (score >= 75) return { text: 'text-green-600', bg: 'bg-green-100 dark:bg-green-900/30', bar: 'bg-green-500' };
  if (score >= 50) return { text: 'text-yellow-600', bg: 'bg-yellow-100 dark:bg-yellow-900/30', bar: 'bg-yellow-500' };
  return { text: 'text-red-600', bg: 'bg-red-100 dark:bg-red-900/30', bar: 'bg-red-500' };
};

const getRecommendationStyle = (rec) => {
  if (rec === 'approve') return { icon: 'CheckCircle2', color: '#22c55e', bg: 'bg-green-50 dark:bg-green-900/20', text: 'text-green-700 dark:text-green-400', border: 'border-green-200 dark:border-green-800', label: 'Auto-Approve Eligible' };
  if (rec === 'flag') return { icon: 'AlertTriangle', color: '#f59e0b', bg: 'bg-yellow-50 dark:bg-yellow-900/20', text: 'text-yellow-700 dark:text-yellow-400', border: 'border-yellow-200 dark:border-yellow-800', label: 'Flag for Review' };
  return { icon: 'XCircle', color: '#ef4444', bg: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-700 dark:text-red-400', border: 'border-red-200 dark:border-red-800', label: 'Reject Document' };
};

const ScoreBar = ({ label, score }) => {
  const colors = getScoreColor(score);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={`text-xs font-bold ${colors.text}`}>{score}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${colors.bar}`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
};

const DocumentQualityScoring = ({ renewal, onScoreUpdate, flagThreshold = 60, autoApproveThreshold = 75 }) => {
  const [scoreData, setScoreData] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastAnalyzedId, setLastAnalyzedId] = useState(null);

  const { response, isLoading, error, sendMessage } = useChat('GEMINI', 'gemini/gemini-2.5-flash', false);

  useEffect(() => {
    if (error) toast.error('AI analysis failed: ' + (error?.message || 'Unknown error'));
  }, [error]);

  useEffect(() => {
    if (response && isAnalyzing) {
      try {
        const cleaned = response?.replace(/```json|```/g, '')?.trim();
        const parsed = JSON.parse(cleaned);
        if (parsed?.overallScore !== undefined) {
          setScoreData(parsed);
          onScoreUpdate?.(renewal?.id, parsed);
          setLastAnalyzedId(renewal?.id);
        }
      } catch {
        toast.error('Could not parse AI response. Please retry.');
      }
      setIsAnalyzing(false);
    }
  }, [response, isAnalyzing]);

  const handleAnalyze = useCallback(() => {
    if (!renewal) return;
    setIsAnalyzing(true);
    setScoreData(null);

    const docDescription = `Document Type: ${renewal?.documentType}\nClient: ${renewal?.clientName}\nClient ID: ${renewal?.clientId}\nDocument URL: ${renewal?.newDocUrl || renewal?.existingDocUrl || 'Not provided'}\nStatus: ${renewal?.status}\nNotes: ${renewal?.notes || 'None'}\nSubmitted: ${renewal?.submittedAt ? new Date(renewal.submittedAt).toLocaleDateString() : 'Not yet submitted'}`;

    sendMessage([
      { role: 'system', content: SCORE_SYSTEM_PROMPT },
      { role: 'user', content: `Analyze this KYC document submission:\n${docDescription}` }
    ], { temperature: 0.2, max_tokens: 500 });
  }, [renewal, sendMessage]);

  const isCurrentDoc = lastAnalyzedId === renewal?.id;
  const displayScore = isCurrentDoc ? scoreData : null;
  const recStyle = displayScore ? getRecommendationStyle(displayScore?.recommendation) : null;
  const overallColors = displayScore ? getScoreColor(displayScore?.overallScore) : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <Icon name="Sparkles" size={15} color="#1A56DB" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Document Quality Score</h3>
            <p className="text-xs text-muted-foreground">AI-powered analysis via Gemini</p>
          </div>
        </div>
        <button
          onClick={handleAnalyze}
          disabled={isLoading || isAnalyzing || !renewal?.newDocUrl && !renewal?.existingDocUrl}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-smooth"
        >
          {(isLoading || isAnalyzing) ? (
            <><Icon name="Loader2" size={12} color="currentColor" className="animate-spin" />Analyzing...</>
          ) : (
            <><Icon name="Zap" size={12} color="currentColor" />Analyze Document</>
          )}
        </button>
      </div>

      {/* Thresholds Info */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <Icon name="CheckCircle2" size={13} color="#22c55e" />
          <div>
            <p className="text-xs font-medium text-green-700 dark:text-green-400">Auto-Approve</p>
            <p className="text-xs text-green-600 dark:text-green-500">Score ≥ {autoApproveThreshold}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <Icon name="Flag" size={13} color="#f59e0b" />
          <div>
            <p className="text-xs font-medium text-yellow-700 dark:text-yellow-400">Flag Threshold</p>
            <p className="text-xs text-yellow-600 dark:text-yellow-500">Score &lt; {flagThreshold}</p>
          </div>
        </div>
      </div>

      {/* Loading State */}
      {(isLoading || isAnalyzing) && (
        <div className="flex flex-col items-center justify-center py-8 space-y-3">
          <div className="w-12 h-12 rounded-full border-2 border-blue-200 border-t-blue-600 animate-spin" />
          <p className="text-xs text-muted-foreground">Gemini AI is analyzing document quality...</p>
        </div>
      )}

      {/* Score Results */}
      {displayScore && !isLoading && !isAnalyzing && (
        <div className="space-y-4">
          {/* Overall Score */}
          <div className={`flex items-center justify-between p-4 rounded-xl border ${overallColors?.bg}`}>
            <div>
              <p className="text-xs text-muted-foreground">Overall Quality Score</p>
              <p className={`text-2xl font-bold mt-0.5 ${overallColors?.text}`}>{displayScore?.overallScore}<span className="text-sm font-normal">/100</span></p>
              <p className="text-xs text-muted-foreground mt-1">{displayScore?.summary}</p>
            </div>
            <div className="w-16 h-16 relative flex items-center justify-center">
              <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted" />
                <circle
                  cx="18" cy="18" r="15.9" fill="none"
                  stroke={displayScore?.overallScore >= 75 ? '#22c55e' : displayScore?.overallScore >= 50 ? '#f59e0b' : '#ef4444'}
                  strokeWidth="2.5"
                  strokeDasharray={`${displayScore?.overallScore} ${100 - displayScore?.overallScore}`}
                  strokeLinecap="round"
                />
              </svg>
              <span className={`absolute text-xs font-bold ${overallColors?.text}`}>{displayScore?.overallScore}</span>
            </div>
          </div>

          {/* Sub-scores */}
          <div className="space-y-3 p-3 bg-muted/40 rounded-xl">
            <p className="text-xs font-semibold text-foreground">Score Breakdown</p>
            <ScoreBar label="Clarity" score={displayScore?.clarity} />
            <ScoreBar label="Completeness" score={displayScore?.completeness} />
            <ScoreBar label="Authenticity" score={displayScore?.authenticity} />
          </div>

          {/* Recommendation */}
          {recStyle && (
            <div className={`flex items-center gap-3 p-3 rounded-xl border ${recStyle?.bg} ${recStyle?.border}`}>
              <Icon name={recStyle?.icon} size={18} color={recStyle?.color} />
              <div>
                <p className={`text-xs font-semibold ${recStyle?.text}`}>{recStyle?.label}</p>
                <p className="text-xs text-muted-foreground">Based on quality score analysis</p>
              </div>
            </div>
          )}

          {/* Issues */}
          {displayScore?.issues?.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-foreground">Detected Issues</p>
              {displayScore?.issues?.map((issue, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Icon name="AlertCircle" size={12} color="#f59e0b" className="mt-0.5 flex-shrink-0" />
                  <span>{issue}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!displayScore && !isLoading && !isAnalyzing && (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mb-3">
            <Icon name="ScanLine" size={22} color="#1A56DB" />
          </div>
          <p className="text-sm font-medium text-foreground">No Analysis Yet</p>
          <p className="text-xs text-muted-foreground mt-1">Click "Analyze Document" to run AI quality scoring</p>
        </div>
      )}
    </div>
  );
};

export default DocumentQualityScoring;
