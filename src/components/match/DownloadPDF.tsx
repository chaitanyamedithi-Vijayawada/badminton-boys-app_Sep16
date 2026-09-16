// components/match/DownloadPDF.tsx
/* eslint-disable @typescript-eslint/no-explicit-any --
   jsPDF/autotable interop over dynamically-shaped round/match data; the code
   uses runtime Array.isArray/typeof guards rather than nominal types here. */
   import { FileDown } from 'lucide-react';
   import type { MatchRound } from '../../types';
   
   interface DownloadPDFProps {
     rounds: MatchRound[];
     sessionName: string;
     dateStr: string;
     playerCount: number;
     courts: number[];
     gamesPlayed: Record<string, number>;
   }
   
   export default function DownloadPDF({
     rounds,
     sessionName,
     dateStr,
     playerCount,
     courts,
     gamesPlayed,
   }: DownloadPDFProps) {
     const handleDownload = async () => {
       try {
         const { jsPDF } = await import('jspdf');
         const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
   
         const pageWidth = doc.internal.pageSize.getWidth();
         const pageHeight = doc.internal.pageSize.getHeight();
         const marginL = 12;
         const marginR = pageWidth - 12;
         const contentWidth = marginR - marginL;
         let y = 22;
   
         const checkPageBreak = (neededSpace: number) => {
           if (y + neededSpace > pageHeight - 14) {
             doc.addPage();
             doc.setPage(doc.getNumberOfPages());
             y = 22;
           }
         };
   
         // HEADER
         doc.setFillColor(15, 23, 42);
         doc.rect(marginL, y - 8, contentWidth, 20, 'F');
         doc.setFontSize(22);
         doc.setFont('helvetica', 'bold');
         doc.setTextColor(255, 255, 255);
         doc.text(sessionName || 'Badminton Boys', pageWidth / 2, y + 4, { align: 'center' });
         y += 18;
   
         doc.setFontSize(12);
         doc.setFont('helvetica', 'normal');
         doc.setTextColor(110, 110, 110);
         doc.text(
           `${dateStr}  ·  ${playerCount} Players  ·  Courts: ${courts.join(', ')}`,
           pageWidth / 2, y, { align: 'center' }
         );
         y += 12;
   
         // ROUNDS
         const roundsList = (Array.isArray(rounds) ? rounds : [])
           .filter(Boolean)
           .sort((a, b) => (a.roundNumber || 0) - (b.roundNumber || 0));
   
         const rowH = 28;          // taller rows for bigger, stacked names
         const courtBoxW = 28;
         const vsW = 10;
         const halfW = (contentWidth - courtBoxW - vsW) / 2;
   
         roundsList.forEach((round: any) => {
           const assignments = Array.isArray(round.assignments) ? round.assignments : [];
           const resting = Array.isArray(round.resting) ? round.resting : [];
           const blockHeight = 13 + assignments.length * rowH + (resting.length > 0 ? 12 : 0) + 6;
           checkPageBreak(blockHeight);
   
           // Round header
           doc.setFillColor(30, 41, 59);
           doc.roundedRect(marginL, y, contentWidth, 11, 1.5, 1.5, 'F');
           doc.setFontSize(14);
           doc.setFont('helvetica', 'bold');
           doc.setTextColor(34, 211, 238);
           doc.text(`ROUND ${round.roundNumber || ''}`, marginL + 5, y + 7.5);
           doc.setFontSize(9);
           if ((round.roundNumber || 0) <= 3) {
             doc.setTextColor(163, 230, 53);
             doc.text('FREE MIX', marginR - 5, y + 7.5, { align: 'right' });
           } else {
             doc.setTextColor(251, 191, 36);
             doc.text('SKILL MATCH', marginR - 5, y + 7.5, { align: 'right' });
           }
           y += 13;
   
           // Court rows — each team's two players are stacked on their own line
           assignments.forEach((match: any, idx: number) => {
             const t1 = (Array.isArray(match.team1) ? match.team1 : [])
               .map((p: any) => (typeof p === 'string' ? p : p?.name || '')).filter(Boolean);
             const t2 = (Array.isArray(match.team2) ? match.team2 : [])
               .map((p: any) => (typeof p === 'string' ? p : p?.name || '')).filter(Boolean);
   
             doc.setDrawColor(51, 65, 85);
             doc.setLineWidth(0.3);
             doc.rect(marginL, y, contentWidth, rowH);
   
             // Court label box
             doc.setFillColor(15, 23, 42);
             doc.rect(marginL, y, courtBoxW, rowH, 'F');
             doc.setFontSize(9);
             doc.setFont('helvetica', 'bold');
             doc.setTextColor(148, 163, 184);
             doc.text('COURT', marginL + courtBoxW / 2, y + 9, { align: 'center' });
             doc.setFontSize(20);
             doc.setTextColor(255, 255, 255);
             doc.text(String(match.court || ''), marginL + courtBoxW / 2, y + 21, { align: 'center' });
   
             const drawTeam = (names: string[], cellX: number, even: boolean) => {
               doc.setFillColor(even ? 248 : 241, even ? 250 : 245, even ? 252 : 248);
               doc.rect(cellX, y, halfW, rowH, 'F');
               doc.setFont('helvetica', 'bold');
               doc.setFontSize(15);
               doc.setTextColor(15, 23, 42);
               const cx = cellX + halfW / 2;
               if (names.length >= 2) {
                 doc.text(names[0], cx, y + 11.5, { align: 'center', maxWidth: halfW - 6 });
                 doc.text(names[1], cx, y + 21, { align: 'center', maxWidth: halfW - 6 });
               } else {
                 doc.text(names[0] || 'TBD', cx, y + rowH / 2 + 2, { align: 'center', maxWidth: halfW - 6 });
               }
             };
   
             // Team 1
             const t1X = marginL + courtBoxW;
             drawTeam(t1, t1X, idx % 2 === 0);
   
             // VS divider
             const vsX = t1X + halfW;
             doc.setFillColor(226, 232, 240);
             doc.rect(vsX, y, vsW, rowH, 'F');
             doc.setFontSize(11);
             doc.setFont('helvetica', 'bold');
             doc.setTextColor(100, 116, 139);
             doc.text('VS', vsX + vsW / 2, y + rowH / 2 + 1.5, { align: 'center' });
   
             // Team 2
             drawTeam(t2, vsX + vsW, idx % 2 === 0);
   
             y += rowH;
           });
   
           // Resting
           if (resting.length > 0) {
             const restNames = resting
               .map((p: any) => (typeof p === 'string' ? p : p?.name || '')).filter(Boolean).join(', ');
             doc.setFillColor(254, 243, 199);
             doc.rect(marginL, y, contentWidth, 10, 'F');
             doc.setDrawColor(251, 191, 36);
             doc.setLineWidth(0.3);
             doc.rect(marginL, y, contentWidth, 10);
             doc.setFontSize(12);
             doc.setFont('helvetica', 'italic');
             doc.setTextColor(146, 64, 14);
             doc.text(`Resting: ${restNames}`, marginL + 4, y + 6.5, { maxWidth: contentWidth - 8 });
             y += 12;
           }
           y += 5;
         });
   
         // GAMES PLAYED SUMMARY
         if (gamesPlayed && Object.keys(gamesPlayed).length > 0) {
           checkPageBreak(40);
           y += 4;
   
           doc.setFillColor(15, 23, 42);
           doc.rect(marginL, y, contentWidth, 10, 'F');
           doc.setFontSize(13);
           doc.setFont('helvetica', 'bold');
           doc.setTextColor(52, 211, 153);
           doc.text('GAMES PLAYED SUMMARY', marginL + 4, y + 7);
           y += 12;
   
           const sorted = Object.entries(gamesPlayed).sort((a, b) => b[1] - a[1]);
           const cols = 2;                 // 2 columns (was 3) so names are larger
           const colW = contentWidth / cols;
           const rowHeight = 9;
   
           sorted.forEach(([name, count], idx) => {
             checkPageBreak(rowHeight);
             const col = idx % cols;
             const colX = marginL + col * colW;
   
             if (col === 0) {
               const shadeA = idx % (cols * 2) < cols;
               doc.setFillColor(shadeA ? 248 : 241, shadeA ? 250 : 245, shadeA ? 252 : 248);
               doc.rect(marginL, y, contentWidth, rowHeight, 'F');
               doc.setDrawColor(226, 232, 240);
               doc.setLineWidth(0.2);
               doc.rect(marginL, y, contentWidth, rowHeight);
             }
   
             const safeName = typeof name === 'string' ? name : (name as any)?.name || '';
             doc.setFontSize(12);
             doc.setFont('helvetica', 'normal');
             doc.setTextColor(30, 41, 59);
             doc.text(`${safeName}`, colX + 3, y + 6, { maxWidth: colW - 14 });
             doc.setFont('helvetica', 'bold');
             doc.setTextColor(15, 118, 110);
             doc.text(`${count}`, colX + colW - 6, y + 6, { align: 'right' });
   
             if (col === cols - 1 || idx === sorted.length - 1) y += rowHeight;
           });
         }
   
         // SAVE
         const cleanSession = (sessionName || 'Session').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
         const cleanDate = (dateStr || 'Schedule').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
         doc.save(`${cleanSession}_${cleanDate}.pdf`);
   
       } catch (error) {
         console.error('PDF export error:', error);
         alert('PDF export failed. Check console for details.');
       }
     };
   
     if (!rounds || rounds.length === 0) return null;
   
     return (
       <button
         type="button"
         onClick={handleDownload}
         className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white transition-colors cursor-pointer"
       >
         <FileDown size={14} /> PDF
       </button>
     );
   }