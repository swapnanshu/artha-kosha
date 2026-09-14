'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Search, BrainCircuit, Download } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

import * as XLSX from 'xlsx';

export default function TransactionsTab() {
  const { token } = useAuth();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfPassword, setPdfPassword] = useState('');
  const [bankType, setBankType] = useState('ICICI');

  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [editingMerchantName, setEditingMerchantName] = useState<string>("");

  const CATEGORIES = [
    "Income", "Food", "Groceries", "Shopping", "Transport", "Utilities",
    "Healthcare", "Entertainment", "Travel", "Investments", "Insurance",
    "Education", "Transfers", "Taxes", "Rent", "EMI", "Subscriptions", "Miscellaneous"
  ];

  const handleUpdateCategory = async (txId: string, newCategory: string) => {
    try {
      const res = await fetch('/api/transactions', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ id: txId, category: newCategory })
      });
      if (res.ok) {
        setTransactions(prev => prev.map(tx => tx.id === txId ? { ...tx, category: newCategory, isVerified: true } : tx));
      }
    } catch (err) {
      console.error('Failed to update category:', err);
    }
  };

  const handleUpdateMerchantName = async (txId: string, newMerchantName: string) => {
    setEditingTxId(null);
    if (!newMerchantName.trim()) return;
    try {
      const res = await fetch('/api/transactions', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ id: txId, merchantName: newMerchantName })
      });
      if (res.ok) {
        setTransactions(prev => prev.map(tx => tx.id === txId ? { ...tx, merchantName: newMerchantName, isVerified: true } : tx));
      }
    } catch (err) {
      console.error('Failed to update merchant name:', err);
    }
  };


  const exportToExcel = () => {
    if (transactions.length === 0) return;
    const worksheet = XLSX.utils.json_to_sheet(transactions.map((tx: any) => ({
      Date: new Date(tx.date).toLocaleDateString(),
      Merchant: tx.merchantName,
      Category: tx.category,
      Amount: tx.amount,
      Type: tx.type === 'expense' ? 'Debit' : 'Credit',
    })));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Transactions");
    XLSX.writeFile(workbook, "Transactions.xlsx");
  };

  const handleUploadPDF = async () => {
    if (!pdfFile) return;
    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', pdfFile);
    formData.append('password', pdfPassword);
    formData.append('bank', bankType);

    try {
      const res = await fetch('/api/transactions/upload-statement', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        await fetchTransactions();
        setPdfFile(null);
        setPdfPassword('');
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to parse statement.');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsUploading(false);
    }
  };

  const fetchTransactions = useCallback(async () => {
    try {
      const res = await fetch('/api/transactions', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setTransactions(data || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      setTimeout(() => fetchTransactions(), 0);
    }
  }, [token, fetchTransactions]);

  const handleSimulateSMS = async () => {
    setIsProcessing(true);
    try {
      await fetch('/api/transactions/simulate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: prompt })
      });
      setPrompt("");
      fetchTransactions();
    } catch (error) {
      console.error(error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="flex gap-4 mb-2 shrink-0">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
          <Input placeholder="Search transactions..." className="pl-9 h-9 text-xs border-gray-800 bg-gray-900 text-gray-300 shadow-sm placeholder:text-gray-600" />
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            className="gap-2 h-9 px-3 text-xs font-semibold bg-gray-900 border border-gray-800 text-gray-300 shadow-sm hover:bg-gray-800"
            onClick={exportToExcel}
            title="Export Excel"
          >
            <Download className="w-4 h-4" />
          </Button>
          <Dialog>
            <DialogTrigger render={<Button variant="secondary" className="gap-2 h-9 text-xs font-semibold bg-gray-900 border border-gray-800 text-gray-300 shadow-sm hover:bg-gray-800" />}>
              <BrainCircuit className="w-4 h-4"/> Parse Text
            </DialogTrigger>
          <DialogContent className="bg-gray-900 text-gray-100 border-gray-800">
            <DialogHeader>
              <DialogTitle>AI Transaction Capture</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
               <textarea 
                  className="w-full min-h-[120px] p-3 text-sm border border-gray-800 bg-gray-950 rounded-md text-gray-300 placeholder:text-gray-600 focus:outline-none focus:border-indigo-500" 
                  placeholder="Paste bank SMS or Email here... (e.g., 'Paid Rs 1250 to SWIGGY via UPI on HDFC Bank')"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
               <Button onClick={handleSimulateSMS} disabled={isProcessing || !prompt.trim()} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white">
                  {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Process via AI 
               </Button>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog>
          <DialogTrigger render={<Button variant="secondary" className="gap-2 h-9 text-xs font-semibold bg-gray-900 border border-gray-800 text-gray-300 shadow-sm hover:bg-gray-800" />}>
            Upload Statement
          </DialogTrigger>
          <DialogContent className="bg-gray-900 text-gray-100 border-gray-800">
            <DialogHeader>
              <DialogTitle>Import Bank Statement (PDF)</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase mb-1 block">Bank Format</label>
                <select value={bankType} onChange={(e)=>setBankType(e.target.value)} className="w-full p-2 h-10 border border-gray-800 bg-gray-950 rounded-md text-sm text-gray-300 focus:outline-none focus:border-indigo-500">
                  <option value="ICICI">ICICI Bank</option>
                  <option value="Kotak">Kotak Mahindra</option>
                  <option value="RBL">RBL Bank</option>
                  <option value="SBI">SBI Card</option>
                  <option value="Other">Other...</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase mb-1 block">Statement PDF</label>
                <input type="file" accept="application/pdf" onChange={(e)=>setPdfFile(e.target.files?.[0] || null)} className="w-full p-2 border border-gray-800 bg-gray-950 rounded-md text-sm text-gray-300 file:bg-gray-800 file:border-0 file:text-gray-300 file:px-3 file:py-1 file:rounded-md file:mr-3 hover:file:bg-gray-700 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase mb-1 block">Password (if protected)</label>
                <Input type="password" value={pdfPassword} onChange={(e)=>setPdfPassword(e.target.value)} placeholder="e.g. swap1234" className="border-gray-800 bg-gray-950 text-gray-300 placeholder:text-gray-600 focus:border-indigo-500" />
              </div>
              <Button onClick={handleUploadPDF} disabled={isUploading || !pdfFile} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white">
                {isUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Analyze and Import
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <Card className="flex-1 flex flex-col border border-gray-800 bg-gray-900 rounded-xl overflow-hidden shadow-sm">
        <CardHeader className="px-4 py-3 border-b border-gray-800 flex flex-row justify-between items-center bg-gray-950/50 space-y-0">
           <CardTitle className="text-xs font-bold text-gray-500 uppercase tracking-widest">Recent Automated Ledger</CardTitle>
           <span className="text-[10px] bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded-full font-semibold uppercase">Live Syncing</span>
        </CardHeader>
        <CardContent className="flex-1 overflow-auto p-0">
          {loading ? (
             <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-gray-500"/></div>
          ) : transactions.length === 0 ? (
             <div className="text-center p-12 text-sm text-gray-500">
                No transactions yet. Click &apos;Parse SMS / Email&apos; to test the AI ingestion.
             </div>
          ) : (
            <Table>
              <TableHeader className="bg-gray-950/50 text-[10px] uppercase text-gray-500 border-b border-gray-800 font-bold">
                <TableRow className="hover:bg-transparent border-b-0">
                  <TableHead className="px-4 py-2 h-auto text-gray-500 font-bold">Date</TableHead>
                  <TableHead className="px-4 py-2 h-auto text-gray-500 font-bold">Merchant</TableHead>
                  <TableHead className="px-4 py-2 h-auto text-gray-500 font-bold">Category</TableHead>
                  <TableHead className="px-4 py-2 h-auto text-gray-500 font-bold">Type</TableHead>
                  <TableHead className="px-4 py-2 h-auto text-gray-500 font-bold text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="text-xs">
                {transactions.map((tx) => (
                  <TableRow key={tx.id} className="border-b border-gray-800/50 hover:bg-gray-800/50 transition-colors cursor-pointer">
                    <TableCell className="px-4 py-3 font-mono text-[10px] text-gray-400 font-medium">{tx.date}</TableCell>
                    <TableCell className="px-4 py-3 font-bold text-gray-200">
                      {editingTxId === tx.id ? (
                        <Input
                          value={editingMerchantName}
                          onChange={(e) => setEditingMerchantName(e.target.value)}
                          onBlur={() => handleUpdateMerchantName(tx.id, editingMerchantName)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleUpdateMerchantName(tx.id, editingMerchantName);
                            if (e.key === 'Escape') setEditingTxId(null);
                          }}
                          autoFocus
                          className="h-7 text-xs bg-gray-950 text-gray-200 border-gray-800 focus:border-indigo-500 max-w-[180px]"
                        />
                      ) : (
                        <span 
                          onDoubleClick={() => {
                            setEditingTxId(tx.id);
                            setEditingMerchantName(tx.merchantName);
                          }}
                          title="Double-click to edit merchant name"
                          className="cursor-pointer hover:text-indigo-400 transition-colors"
                        >
                          {tx.merchantName}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <select 
                        value={tx.category}
                        onChange={(e) => handleUpdateCategory(tx.id, e.target.value)}
                        className="bg-transparent border border-gray-800 rounded px-1.5 py-0.5 text-[10px] font-bold text-gray-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
                      >
                         {CATEGORIES.map(cat => (
                           <option key={cat} value={cat} className="bg-gray-950 text-gray-300">{cat}</option>
                         ))}
                      </select>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                       {tx.isVerified ? <span className="text-emerald-400 text-xs font-bold">✓ Verified</span> : <span className="text-indigo-400 text-xs font-bold">✓ AI</span>}
                    </TableCell>
                    <TableCell className={`px-4 py-3 text-right font-bold ${tx.type === 'expense' ? 'text-gray-200' : 'text-emerald-400'}`}>
                      {tx.type === 'expense' ? '-₹' : '+₹'}{parseFloat(tx.amount).toLocaleString('en-IN')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
