import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import {
  getFirestore,
  collection,
  addDoc,
  query,
  onSnapshot,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  writeBatch,
  where,
  getDocs,
  updateDoc
} from 'firebase/firestore';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line
} from 'recharts';
import {
  ArrowLeft, ArrowRight, Plus, Trash2, Settings, ArrowLeftCircle,
  ChevronUp, ChevronDown, Wallet, CheckCircle, Sun, Moon, Upload,
  Download, Repeat, TrendingUp, TrendingDown, PiggyBank, Target, List
} from 'lucide-react';


// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDsq42-1Bfci5ekHA_4raDcfEWohmIZuC4",
  authDomain: "basic-budget-6ca2f.firebaseapp.com",
  projectId: "basic-budget-6ca2f",
  storageBucket: "basic-budget-6ca2f.firebasestorage.app",
  messagingSenderId: "824405162451",
  appId: "1:824405162451:web:6a0c6bcaed894cdb1cd726"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);


// --- Firebase Initialization ---
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);


// --- Helper Functions & Constants ---
const DEFAULT_CATEGORIES = [
  { name: 'Groceries', color: '#4CAF50' },
  { name: 'Rent', color: '#F44336' },
  { name: 'Transport', color: '#2196F3' },
  { name: 'Entertainment', color: '#FFC107' },
  { name: 'Utilities', color: '#9C27B0' },
  { name: 'Health', color: '#009688' },
  { name: 'Other', color: '#795548' },
];


const DEFAULT_CURRENCIES = [
  { symbol: '$', name: 'USD' },
  { symbol: '€', name: 'EUR' },
  { symbol: '£', name: 'GBP' },
  { symbol: 'C', name: 'Credits' },
];


const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];


// --- App / Firestore path helpers ---
const APP_ID = (typeof window !== 'undefined' && typeof __app_id !== 'undefined') ? __app_id : 'default-app-id';
const basePath = `artifacts/${APP_ID}`;
const userPath = (uid) => `${basePath}/users/${uid}`;
const expensesColPath = (uid) => `${userPath(uid)}/expenses`;
const incomeColPath   = (uid) => `${userPath(uid)}/income`;
const budgetsColPath  = (uid) => `${userPath(uid)}/budgets`;
const budgetDocPath   = (uid, bid) => `${budgetsColPath(uid)}/${bid}`;
const categoriesColPath = (uid, bid) => `${budgetDocPath(uid, bid)}/categories`;
const recurringColPath  = (uid, bid) => `${budgetDocPath(uid, bid)}/recurringTransactions`;
const currenciesColPath = (uid) => `${userPath(uid)}/currencies`;
const settingsDocPath   = (uid) => `${userPath(uid)}/settings/preferences`;


// --- Date & CSV helpers ---
const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };


// Add 1 interval to a given date (clamps month-end)
const addInterval = (date, frequency) => {
  const d = new Date(date);
  if (frequency === 'daily') d.setDate(d.getDate() + 1);
  else if (frequency === 'weekly') d.setDate(d.getDate() + 7);
  else if (frequency === 'monthly') {
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDay));
  }
  d.setHours(0,0,0,0);
  return d;
};


// Force local date → yyyy-mm-dd (no timezone shift)
const toInputDate = (d) => {
  const dt = new Date(d);
  const tz = dt.getTimezoneOffset() * 60000;
  return new Date(dt.getTime() - tz).toISOString().slice(0,10);
};


const formatDateYMD = (d) => {
  const x = new Date(d);
  const tz = x.getTimezoneOffset() * 60000;
  return new Date(x.getTime() - tz).toISOString().slice(0,10);
};


const csvEscape = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};


// Minimal CSV parser that respects quoted fields and commas
const parseCSV = (text) => {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(Boolean);
  if (lines.length === 0) return [];
  const [, ...dataLines] = lines; // skip header


  const parseLine = (line) => {
    const out = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i+1] === '"') { cur += '"'; i++; } else { inQ = false; }
        } else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') { out.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    out.push(cur);
    return out;
  };


  return dataLines.map(parseLine).map(([date, category, price, comment]) => ({
    date: new Date(date),
    category,
    price: parseFloat(price),
    comment: comment || ''
  })).filter(e => !isNaN(e.date) && e.category && !isNaN(e.price));
};


// --- Main App Component ---
export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [expenses, setExpenses] = useState([]);
  const [income, setIncome] = useState([]);
  const [budgetCategories, setBudgetCategories] = useState([]);
  const [userCurrencies, setUserCurrencies] = useState([]);
  const [recurringTransactions, setRecurringTransactions] = useState([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [isIncomeModalOpen, setIsIncomeModalOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [currency, setCurrency] = useState('$');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [theme, setTheme] = useState('light');


  // Budget state
  const [budgets, setBudgets] = useState([]);
  const [activeBudgetId, setActiveBudgetId] = useState(null);
  const [isBudgetModalOpen, setIsBudgetModalOpen] = useState(false);


  // Import/Export State
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importedData, setImportedData] = useState(null);


  // Dashboard customization state
  const [collapsedCards, setCollapsedCards] = useState({});
  const [visibleCards, setVisibleCards] = useState({ budgetProgress: true, incomeVsExpense: true, pie: true, bar: true, trend: true });
  const [yearOffset, setYearOffset] = useState(0);
  const [trendOffset, setTrendOffset] = useState(0);


  const fileInputRef = useRef(null);
  const activeBudget = useMemo(() => budgets.find(b => b.id === activeBudgetId), [budgets, activeBudgetId]);


  // --- Theme Management ---
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);


  // --- Authentication ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setAuthLoading(false);
      } else {
        // No user, attempt sign in
        try {
          // Use custom token if provided by the environment
          if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(auth, __initial_auth_token);
          } else {
            // Fallback to anonymous sign-in for local development
            await signInAnonymously(auth);
          }
          // onAuthStateChanged will be re-triggered with the new user, updating state
        } catch (error) {
          console.error("Authentication failed:", error);
          setAuthLoading(false); // Stop loading on error
        }
      }
    });
    return () => unsubscribe();
  }, []);


  // --- Recurring Transactions Processor (robust, chunked, cursor-based) ---
  useEffect(() => {
    if (!user || !activeBudget || !activeBudget.recurringEnabled || recurringTransactions.length === 0) return;


    const processRecurringTransactions = async () => {
      const today = startOfDay(new Date());
      let batch = writeBatch(db);
      let writesInBatch = 0;
      const MAX_PER_BATCH = 450;         // headroom < 500 Firestore limit
      const MAX_OCCURRENCES_PER_RT = 150;  // safety guard per run


      const flush = async () => {
        if (writesInBatch === 0) return;
        await batch.commit().catch((e) => console.error("Batch commit error:", e));
        batch = writeBatch(db);
        writesInBatch = 0;
      };


      for (const rt of recurringTransactions) {
        // Interpret stored value as a "cursor to NEXT due date"
        let nextDue = rt.lastProcessedDate?.toDate ? rt.lastProcessedDate.toDate() : (rt.lastProcessedDate || null);
        const start = rt.startDate?.toDate ? rt.startDate.toDate() : rt.startDate;


        // If sentinel (e.g., startDate - 1 day) or missing, begin at start date
        if (!nextDue || (start && startOfDay(nextDue) < startOfDay(start))) {
          nextDue = start ? startOfDay(start) : startOfDay(new Date());
        } else {
          nextDue = startOfDay(nextDue);
        }


        let createdAny = false;
        let guard = 0;


        while (nextDue <= today && guard < MAX_OCCURRENCES_PER_RT) {
          if (rt.type === 'expense') {
            const ref = doc(collection(db, expensesColPath(user.uid)));
            batch.set(ref, {
              price: rt.amount,
              category: rt.category,
              comment: rt.description,
              date: new Date(nextDue),
              budgetId: activeBudgetId,
            });
          } else {
            const ref = doc(collection(db, incomeColPath(user.uid)));
            batch.set(ref, {
              amount: rt.amount,
              description: rt.description,
              date: new Date(nextDue),
              budgetId: activeBudgetId,
            });
          }
          createdAny = true;
          writesInBatch++;
          if (writesInBatch >= MAX_PER_BATCH) await flush();


          // advance cursor
          nextDue = addInterval(nextDue, rt.frequency);
          guard++;
        }


        // Only update the cursor when we actually created entries
        if (createdAny) {
          const rtRef = doc(db, `${recurringColPath(user.uid, activeBudgetId)}/${rt.id}`);
          batch.update(rtRef, { lastProcessedDate: nextDue }); // store first future date
          writesInBatch++;
          if (writesInBatch >= MAX_PER_BATCH) await flush();
        }
      }


      await flush();
    };


    processRecurringTransactions().catch((e) => console.error("Error processing recurring transactions:", e));
  }, [user, activeBudgetId, activeBudget?.recurringEnabled, recurringTransactions]);


  // --- Firestore Data Fetching ---
  useEffect(() => {
    if (!user) return;
    let unsubscribers = [];


    if (activeBudgetId) {
      const expensesQueryRef = query(collection(db, expensesColPath(user.uid)), where("budgetId", "==", activeBudgetId));
      unsubscribers.push(onSnapshot(expensesQueryRef, s =>
        setExpenses(s.docs.map(d => ({ ...d.data(), id: d.id, date: d.data().date.toDate() })))
      ));


      const incomeQueryRef = query(collection(db, incomeColPath(user.uid)), where("budgetId", "==", activeBudgetId));
      unsubscribers.push(onSnapshot(incomeQueryRef, s =>
        setIncome(s.docs.map(d => ({ ...d.data(), id: d.id, date: d.data().date.toDate() })))
      ));


      const categoriesColRef = collection(db, categoriesColPath(user.uid, activeBudgetId));
      unsubscribers.push(onSnapshot(categoriesColRef, (snapshot) => {
        const categoriesData = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        setBudgetCategories(categoriesData);
        if (categoriesData.length > 0 && !categoriesData.some(c => c.name === selectedCategory)) {
          setSelectedCategory(categoriesData[0].name);
        } else if (categoriesData.length === 0) setSelectedCategory('');
      }));


      const recurringColRef = collection(db, recurringColPath(user.uid, activeBudgetId));
      unsubscribers.push(onSnapshot(recurringColRef, (snapshot) =>
        setRecurringTransactions(snapshot.docs.map(d => ({ id: d.id, ...d.data() })))
      ));


    } else {
      setExpenses([]); setIncome([]); setBudgetCategories([]); setRecurringTransactions([]);
    }


    const settingsDocRef = doc(db, settingsDocPath(user.uid));
    unsubscribers.push(onSnapshot(settingsDocRef, (docSnap) => {
      const data = docSnap.data() || {};
      setCurrency(data.currency || '$');
      setTheme(data.theme || 'light');
      setVisibleCards(data.visibleCards || { budgetProgress: true, incomeVsExpense: true, pie: true, bar: true, trend: true });
      setActiveBudgetId(data.activeBudgetId || null);
    }));


    const budgetsColRef = collection(db, budgetsColPath(user.uid));
    unsubscribers.push(onSnapshot(budgetsColRef, async (querySnapshot) => {
      if (querySnapshot.empty) {
        await handleCreateBudget("Main Budget", true);
      } else {
        const budgetsData = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        setBudgets(budgetsData);
        if (!budgetsData.some(b => b.id === activeBudgetId) && budgetsData.length > 0) {
          await handleSettingsSave({ activeBudgetId: budgetsData[0].id });
        }
      }
    }));


    const currenciesColRef = collection(db, currenciesColPath(user.uid));
    unsubscribers.push(onSnapshot(currenciesColRef, async (querySnapshot) => {
      if (querySnapshot.empty) {
        const batch = writeBatch(db);
        DEFAULT_CURRENCIES.forEach(curr => batch.set(doc(currenciesColRef), curr));
        await batch.commit();
      } else {
        setUserCurrencies(querySnapshot.docs.map(d => ({ id: d.id, ...d.data() })));
      }
    }));


    return () => unsubscribers.forEach(unsub => unsub());
  }, [user, activeBudgetId]);


  // --- Memoized Data ---
  const monthlyData = useMemo(() => {
    const month = currentDate.getMonth();
    const year = currentDate.getFullYear();
    return expenses.filter(e => e.date.getMonth() === month && e.date.getFullYear() === year)
      .reduce((acc, expense) => {
        const existing = acc.find(item => item.name === expense.category);
        if (existing) { existing.value += expense.price; }
        else { acc.push({ name: expense.category, value: expense.price }); }
        return acc;
      }, []);
  }, [expenses, currentDate]);


  const monthlyTotal = useMemo(() => monthlyData.reduce((sum, item) => sum + item.value, 0), [monthlyData]);


  const monthlyIncomeTotal = useMemo(() => {
    const month = currentDate.getMonth();
    const year = currentDate.getFullYear();
    return income.filter(i => i.date.getMonth() === month && i.date.getFullYear() === year)
               .reduce((sum, item) => sum + item.amount, 0);
  }, [income, currentDate]);


  const yearlyData = useMemo(() => {
    const targetYear = new Date().getFullYear() + yearOffset;
    const data = Array(12).fill(0).map((_, i) => ({ name: MONTHS[i].substring(0, 3), total: 0 }));
    expenses.filter(e => e.date.getFullYear() === targetYear)
      .forEach(expense => { data[expense.date.getMonth()].total += expense.price; });
    return data;
  }, [expenses, yearOffset]);


  const categoryTrendData = useMemo(() => {
    const data = [];
    const today = new Date();
    const startDate = new Date(today.getFullYear(), today.getMonth() - trendOffset, 1);
    for (let i = 11; i >= 0; i--) {
      const d = new Date(startDate.getFullYear(), startDate.getMonth() - i, 1);
      const [month, year] = [d.getMonth(), d.getFullYear()];
      const monthlyTotal = expenses
        .filter(e => e.category === selectedCategory && e.date.getMonth() === month && e.date.getFullYear() === year)
        .reduce((sum, e) => sum + e.price, 0);
      data.push({ name: `${MONTHS[month].substring(0, 3)} ${year.toString().slice(-2)}`, total: monthlyTotal });
    }
    return data;
  }, [expenses, selectedCategory, trendOffset]);


  // --- Event Handlers ---
  const handleAddExpense = async (expense) => {
    if (!user || !activeBudgetId) return;
    await addDoc(collection(db, expensesColPath(user.uid)), { ...expense, budgetId: activeBudgetId });
    setIsExpenseModalOpen(false);
  };


  const handleAddIncome = async (incomeObj) => {
    if (!user || !activeBudgetId) return;
    await addDoc(collection(db, incomeColPath(user.uid)), { ...incomeObj, budgetId: activeBudgetId });
    setIsIncomeModalOpen(false);
  };


  const handleDeleteExpense = async (id) => {
    if (!user) return;
    await deleteDoc(doc(db, expensesColPath(user.uid), id));
  };


  const handleDeleteIncome = async (id) => {
    if (!user) return;
    await deleteDoc(doc(db, incomeColPath(user.uid), id));
  };


  const handleSettingsSave = async (settings) => {
    if (!user) return;
    const settingsDocRef = doc(db, settingsDocPath(user.uid));
    await setDoc(settingsDocRef, settings, { merge: true });
  };


  const handleAddCategory = async (category) => {
    if (!user || !activeBudgetId) return;
    await addDoc(collection(db, categoriesColPath(user.uid, activeBudgetId)), category);
  };


  const handleDeleteCategory = async (categoryId, categoryName) => {
    if (!user || !activeBudgetId) return;
    if ((categoryName || '').trim().toLowerCase() === 'other') {
      alert('The "Other" category is required and cannot be deleted.');
      return;
    }
    await deleteDoc(doc(db, categoriesColPath(user.uid, activeBudgetId), categoryId));


    // Reassign expenses in this budget with the deleted category to "Other"
    const expensesToUpdateQuery = query(
      collection(db, expensesColPath(user.uid)),
      where("category", "==", categoryName),
      where("budgetId", "==", activeBudgetId)
    );
    const querySnapshot = await getDocs(expensesToUpdateQuery);
    const batch = writeBatch(db);
    querySnapshot.forEach((expDoc) => batch.update(expDoc.ref, { category: "Other" }));
    await batch.commit();
  };


  const handleCreateBudget = async (name, setActive = false) => {
    if (!user || !name.trim()) return;
    const newBudgetRef = doc(collection(db, budgetsColPath(user.uid)));
    await setDoc(newBudgetRef, { name: name.trim(), createdAt: new Date(), recurringEnabled: false, limit: null });


    const catsColRef = collection(db, categoriesColPath(user.uid, newBudgetRef.id));
    const batch = writeBatch(db);
    DEFAULT_CATEGORIES.forEach(cat => batch.set(doc(catsColRef), cat));
    await batch.commit();


    if (setActive) {
      await handleSettingsSave({ activeBudgetId: newBudgetRef.id });
    }
    return newBudgetRef.id;
  };


  const handleUpdateBudgetLimit = (limit) => {
    if (!user || !activeBudgetId) return;
    const budgetDocRef = doc(db, budgetDocPath(user.uid, activeBudgetId));
    updateDoc(budgetDocRef, { limit: (limit != null ? limit : null) });
  };


  const handleSelectBudget = (budgetId) => handleSettingsSave({ activeBudgetId: budgetId });
  const handleAddCurrency = (currencyObj) => addDoc(collection(db, currenciesColPath(user.uid)), currencyObj);
  const handleDeleteCurrency = (id) => deleteDoc(doc(db, currenciesColPath(user.uid), id));


  const handleExport = () => {
    if (expenses.length === 0) return alert("No expenses to export.");
    const header = "date,category,price,comment\n";
    const rows = expenses.map(e => [
      formatDateYMD(e.date),
      csvEscape(e.category),
      csvEscape(e.price),
      csvEscape(e.comment || '')
    ].join(',')).join('\n');


    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `budget-export-${(activeBudget?.name || 'budget')}-${formatDateYMD(new Date())}.csv`;
    link.click();
  };


  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const imported = parseCSV(String(event.target?.result || ''));
      setImportedData(imported);
      setIsImportModalOpen(true);
    };
    reader.readAsText(file);
    e.target.value = null;
  };


  const handleImport = async (targetBudgetId, newBudgetName) => {
    if (!user || !importedData) return;


    let finalBudgetId = targetBudgetId;
    if (newBudgetName) finalBudgetId = await handleCreateBudget(newBudgetName, false);
    if (!finalBudgetId) return alert("Could not determine budget for import.");


    // Fetch categories from the *target* budget
    const catsSnap = await getDocs(collection(db, categoriesColPath(user.uid, finalBudgetId)));
    const existingNames = new Set(catsSnap.docs.map(d => d.data().name));


    const newNames = [...new Set(importedData.map(e => e.category))]
      .filter(n => n && !existingNames.has(n));


    let batch = writeBatch(db);
    let writes = 0;
    const MAX_PER_BATCH = 450;
    const flush = async () => {
      if (!writes) return;
      await batch.commit();
      batch = writeBatch(db);
      writes = 0;
    };


    // Add missing categories
    newNames.forEach(name => {
      const color = `#${Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')}`;
      batch.set(doc(collection(db, categoriesColPath(user.uid, finalBudgetId))), { name, color });
      writes++;
    });


    // Add expenses
    importedData.forEach(expense => {
      batch.set(doc(collection(db, expensesColPath(user.uid))), { ...expense, budgetId: finalBudgetId });
      writes++;
      if (writes >= MAX_PER_BATCH) flush();
    });


    await flush();
    setIsImportModalOpen(false);
    setImportedData(null);
    alert(`${importedData.length} expenses imported successfully!`);
  };


  const changeMonth = (offset) => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + offset, 1));
  const toggleCardCollapse = (cardKey) => setCollapsedCards(prev => ({ ...prev, [cardKey]: !prev[cardKey] }));
  const handleBudgetRecurrenceToggle = (enabled) =>
    updateDoc(doc(db, budgetDocPath(user.uid, activeBudgetId)), { recurringEnabled: enabled });
  const handleAddRecurringTransaction = (rt) =>
    addDoc(collection(db, recurringColPath(user.uid, activeBudgetId)), rt);
  const handleDeleteRecurringTransaction = (id) =>
    deleteDoc(doc(db, recurringColPath(user.uid, activeBudgetId), id));


  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100 dark:bg-gray-900">
        <div className="text-lg font-semibold text-gray-800 dark:text-gray-200">Loading...</div>
      </div>
    );
  }


  return (
    <div className="bg-gray-50 dark:bg-gray-900 min-h-screen font-sans text-gray-800 dark:text-gray-200">
      <div className="container mx-auto p-4 sm:p-6 lg:p-8">
        <Header
          user={user}
          onAddExpense={() => setIsExpenseModalOpen(true)}
          onAddIncome={() => setIsIncomeModalOpen(true)}
          onNavigate={setCurrentPage}
          onOpenBudgetModal={() => setIsBudgetModalOpen(true)}
          activeBudgetName={activeBudget?.name}
        />
        <main>
          {currentPage === 'dashboard' ? (
            <Dashboard
              activeBudget={activeBudget}
              currentDate={currentDate} changeMonth={changeMonth} visibleCards={visibleCards}
              monthlyData={monthlyData} currency={currency} budgetCategories={budgetCategories} monthlyTotal={monthlyTotal}
              monthlyIncomeTotal={monthlyIncomeTotal}
              yearlyData={yearlyData} yearOffset={yearOffset} setYearOffset={setYearOffset}
              categoryTrendData={categoryTrendData} selectedCategory={selectedCategory} setSelectedCategory={setSelectedCategory}
              trendOffset={trendOffset} setTrendOffset={setTrendOffset} collapsedCards={collapsedCards} toggleCardCollapse={toggleCardCollapse}
              expenses={expenses} handleDeleteExpense={handleDeleteExpense}
              income={income} handleDeleteIncome={handleDeleteIncome}
            />
          ) : currentPage === 'settings' ? (
            <SettingsPage
              onNavigate={setCurrentPage}
              activeBudget={activeBudget}
              onBudgetRecurrenceToggle={handleBudgetRecurrenceToggle}
              onUpdateBudgetLimit={handleUpdateBudgetLimit}
              recurringTransactions={recurringTransactions}
              onAddRecurringTransaction={handleAddRecurringTransaction}
              onDeleteRecurringTransaction={handleDeleteRecurringTransaction}
              budgetCategories={budgetCategories}
              onAddCategory={handleAddCategory}
              onDeleteCategory={handleDeleteCategory}
              userCurrencies={userCurrencies}
              currentCurrency={currency}
              onCurrencyChange={(c) => handleSettingsSave({ currency: c })}
              onAddCurrency={handleAddCurrency}
              onDeleteCurrency={handleDeleteCurrency}
              theme={theme} onThemeChange={(t) => handleSettingsSave({ theme: t })}
              visibleCards={visibleCards} onVisibilityChange={(key, v) => handleSettingsSave({ visibleCards: { ...visibleCards, [key]: v } })}
              onExport={handleExport} onImportClick={() => fileInputRef.current.click()}
            />
          ) : (
            <AllTransactionsPage
              expenses={expenses}
              income={income}
              currency={currency}
              budgetCategories={budgetCategories}
              onDeleteExpense={handleDeleteExpense}
              onDeleteIncome={handleDeleteIncome}
              onNavigate={setCurrentPage}
            />
          )}
        </main>
      </div>
      <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".csv" style={{ display: 'none' }} />
      {isExpenseModalOpen && <AddExpenseModal categories={budgetCategories} onClose={() => setIsExpenseModalOpen(false)} onAddExpense={handleAddExpense} />}
      {isIncomeModalOpen && <AddIncomeModal onClose={() => setIsIncomeModalOpen(false)} onAddIncome={handleAddIncome} />}
      {isBudgetModalOpen && <BudgetModal budgets={budgets} activeBudgetId={activeBudgetId} onSelect={handleSelectBudget} onCreate={handleCreateBudget} onClose={() => setIsBudgetModalOpen(false)} />}
      {isImportModalOpen && <ImportModal budgets={budgets} onImport={handleImport} onClose={() => setIsImportModalOpen(false)} dataCount={importedData?.length || 0} />}
    </div>
  );
}


// --- Dashboard Components ---
const Dashboard = (props) => (
  <>
    <DashboardHeader currentDate={props.currentDate} changeMonth={props.changeMonth} />
    <div className="grid grid-cols-1 gap-6">
      {props.activeBudget?.limit > 0 && props.visibleCards.budgetProgress && (
        <BudgetProgressCard
          limit={props.activeBudget.limit}
          currentSpending={props.monthlyTotal}
          currency={props.currency}
          isCollapsed={!!props.collapsedCards['budgetProgress']}
          onToggleCollapse={() => props.toggleCardCollapse('budgetProgress')}
        />
      )}
      {props.visibleCards.incomeVsExpense && (
        <IncomeVsExpenseCard
          income={props.monthlyIncomeTotal}
          expenses={props.monthlyTotal}
          currency={props.currency}
          isCollapsed={!!props.collapsedCards['incomeVsExpense']}
          onToggleCollapse={() => props.toggleCardCollapse('incomeVsExpense')}
        />
      )}
      {props.visibleCards.pie && (
        <CategoryVisualization
          data={props.monthlyData}
          currency={props.currency}
          categories={props.budgetCategories}
          monthlyTotal={props.monthlyTotal}
          isCollapsed={!!props.collapsedCards['pie']}
          onToggleCollapse={() => props.toggleCardCollapse('pie')}
        />
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {props.visibleCards.bar && (
          <MonthlySumVisualization
            data={props.yearlyData}
            currency={props.currency}
            yearOffset={props.yearOffset}
            onYearChange={props.setYearOffset}
            isCollapsed={!!props.collapsedCards['bar']}
            onToggleCollapse={() => props.toggleCardCollapse('bar')}
          />
        )}
        {props.visibleCards.trend && (
          <CategoryTrendVisualization
            data={props.categoryTrendData}
            currency={props.currency}
            selectedCategory={props.selectedCategory}
            onCategoryChange={props.setSelectedCategory}
            categories={props.budgetCategories}
            trendOffset={props.trendOffset}
            onTrendChange={props.setTrendOffset}
            isCollapsed={!!props.collapsedCards['trend']}
            onToggleCollapse={() => props.toggleCardCollapse('trend')}
          />
        )}
      </div>
    </div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
      <ExpenseList
        expenses={props.expenses.filter(e => e.date.getMonth() === props.currentDate.getMonth() && e.date.getFullYear() === props.currentDate.getFullYear())}
        onDelete={props.handleDeleteExpense}
        currency={props.currency}
        categories={props.budgetCategories}
      />
      <IncomeList
        income={props.income.filter(i => i.date.getMonth() === props.currentDate.getMonth() && i.date.getFullYear() === props.currentDate.getFullYear())}
        onDelete={props.handleDeleteIncome}
        currency={props.currency}
      />
    </div>
  </>
);


// --- Sub-components ---
const Header = ({ user, onAddExpense, onAddIncome, onNavigate, onOpenBudgetModal, activeBudgetName }) => (
  <header className="relative flex items-center justify-between mb-6 pb-4 border-b border-gray-200 dark:border-gray-700">
    <div>
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Budget Dashboard</h1>
      {activeBudgetName && <p className="text-sm text-indigo-600 dark:text-indigo-400 font-semibold">{activeBudgetName}</p>}
       <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 truncate" title={user?.uid}>User ID: {user?.uid}</p>
    </div>


    <div className="absolute left-1/2 -translate-x-1/2 flex gap-2">
      <button onClick={onAddIncome} className="flex items-center bg-green-600 text-white font-semibold py-2 px-4 rounded-lg shadow-md hover:bg-green-700 transition-colors duration-300"><Plus size={20} className="mr-2" />Add Income</button>
      <button onClick={onAddExpense} className="flex items-center bg-indigo-600 text-white font-semibold py-2 px-4 rounded-lg shadow-md hover:bg-indigo-700 transition-colors duration-300"><Plus size={20} className="mr-2" />Add Expense</button>
    </div>


    <div className="flex items-center gap-2">
      <button onClick={onOpenBudgetModal} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"><Wallet size={24} className="text-gray-600 dark:text-gray-300" /></button>
      <button onClick={() => onNavigate('transactions')} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"><List size={24} className="text-gray-600 dark:text-gray-300" /></button>
      <button onClick={() => onNavigate('settings')} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"><Settings size={24} className="text-gray-600 dark:text-gray-300" /></button>
    </div>
  </header>
);


const DashboardHeader = ({ currentDate, changeMonth }) => (
  <div className="flex items-center justify-center my-6 p-4 bg-white dark:bg-gray-800 rounded-lg shadow">
    <button onClick={() => changeMonth(-1)} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"><ArrowLeft size={24} /></button>
    <h2 className="text-2xl font-semibold mx-6 w-52 text-center">{MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}</h2>
    <button onClick={() => changeMonth(1)} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"><ArrowRight size={24} /></button>
  </div>
);


const Card = ({ title, titleExtra, children, controls, isCollapsed, onToggleCollapse, navControls }) => (
  <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg hover:shadow-xl transition-shadow duration-300 h-full flex flex-col">
    <div className="flex justify-between items-center mb-4">
      <div className="flex items-baseline gap-3">
        <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap overflow-hidden text-ellipsis">{title}</h3>
        {titleExtra}
      </div>
      <div className="flex items-center gap-2">
        {controls}
        {navControls}
        <button onClick={onToggleCollapse} className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700">
          {isCollapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
        </button>
      </div>
    </div>
    {!isCollapsed && <div className="flex-grow">{children}</div>}
  </div>
);


const BudgetProgressCard = ({ limit, currentSpending, currency, isCollapsed, onToggleCollapse }) => {
  const percentage = limit > 0 ? (currentSpending / limit) * 100 : 0;
  const remaining = limit - currentSpending;
  const progressColor = percentage > 100 ? 'bg-red-500' : percentage > 80 ? 'bg-yellow-500' : 'bg-green-500';


  return (
    <Card title="Budget Progress" isCollapsed={isCollapsed} onToggleCollapse={onToggleCollapse}>
      <div className="space-y-3 h-full flex flex-col justify-center">
        <div>
          <div className="flex justify-between items-baseline mb-1">
            <span className="text-2xl font-bold text-gray-800 dark:text-gray-100">{currency}{currentSpending.toFixed(2)}</span>
            <span className="text-lg text-gray-500 dark:text-gray-400">/ {currency}{limit.toFixed(2)}</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-4">
            <div className={`${progressColor} h-4 rounded-full transition-all duration-500`} style={{ width: `${Math.min(percentage, 100)}%` }}></div>
          </div>
        </div>
        <div className="text-center">
          <p className={`text-xl font-semibold ${remaining >= 0 ? 'text-gray-700 dark:text-gray-200' : 'text-red-500'}`}>
            {remaining >= 0 ? `${currency}${remaining.toFixed(2)} remaining` : `${currency}${Math.abs(remaining).toFixed(2)} over budget`}
          </p>
        </div>
      </div>
    </Card>
  );
};


const IncomeVsExpenseCard = ({ income, expenses, currency, isCollapsed, onToggleCollapse }) => {
  const net = income - expenses;
  const hasData = income > 0 || expenses > 0;


  return (
    <Card title="Monthly Summary" isCollapsed={isCollapsed} onToggleCollapse={onToggleCollapse}>
      {hasData ? (
        <div className="flex flex-col md:flex-row justify-around items-center h-full gap-6">
          <div className="text-center">
            <div className="flex items-center gap-2 justify-center text-green-600 dark:text-green-400">
              <TrendingUp size={24}/>
              <h4 className="text-lg font-semibold">Income</h4>
            </div>
            <p className="text-3xl font-bold">{currency}{income.toFixed(2)}</p>
          </div>
          <div className="text-center">
            <div className="flex items-center gap-2 justify-center text-red-600 dark:text-red-400">
               <TrendingDown size={24}/>
               <h4 className="text-lg font-semibold">Expenses</h4>
            </div>
            <p className="text-3xl font-bold">{currency}{expenses.toFixed(2)}</p>
          </div>
          <div className="text-center">
            <div className={`flex items-center gap-2 justify-center ${net >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-orange-500 dark:text-orange-400'}`}>
              <PiggyBank size={24}/>
              <h4 className="text-lg font-semibold">Net Balance</h4>
            </div>
            <p className={`text-3xl font-bold`}>
               {currency}{net.toFixed(2)}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-center text-gray-500 dark:text-gray-400 pt-20">No income or expense data for this month.</p>
      )}
    </Card>
  );
};


const CategoryVisualization = ({ data, currency, categories, isCollapsed, onToggleCollapse, monthlyTotal }) => {
  const titleExtraContent = data.length > 0 ? ( <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{currency}{monthlyTotal.toFixed(2)}</span>) : null;
  return (
    <Card title="Expenses by Category" titleExtra={titleExtraContent} isCollapsed={isCollapsed} onToggleCollapse={onToggleCollapse}>
      <div className="h-64">
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
              {data.map((entry, index) => <Cell key={`cell-${index}`} fill={categories.find(c => c.name === entry.name)?.color || '#8884d8'} />)}
            </Pie>
            <Tooltip formatter={(value) => `${currency}${value.toFixed(2)}`} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      ) : <p className="text-center text-gray-500 dark:text-gray-400 pt-20">No expenses for this month.</p>}
      </div>
    </Card>
  );
};


const MonthlySumVisualization = ({ data, currency, isCollapsed, onToggleCollapse, yearOffset, onYearChange }) => {
  const targetYear = new Date().getFullYear() + yearOffset;
  const navControls = (
    <div className="flex items-center border dark:border-gray-600 rounded-md">
      <button onClick={() => onYearChange(p => p - 1)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-l-md"><ArrowLeft size={16} /></button>
      <button onClick={() => onYearChange(p => p + 1)} disabled={yearOffset >= 0} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-r-md border-l dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"><ArrowRight size={16} /></button>
    </div>
  );
  return (
    <Card title={`Monthly Totals (${targetYear})`} isCollapsed={isCollapsed} onToggleCollapse={onToggleCollapse} navControls={navControls}>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
            <XAxis dataKey="name" />
            <YAxis tickFormatter={(value) => `${currency}${value}`} />
            <Tooltip formatter={(value) => `${currency}${value.toFixed(2)}`} />
            <Bar dataKey="total" fill="#8884d8" name="Total Expenses" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
};


const CategoryTrendVisualization = ({ data, currency, selectedCategory, onCategoryChange, categories, isCollapsed, onToggleCollapse, trendOffset, onTrendChange }) => {
  const navControls = (
    <div className="flex items-center border dark:border-gray-600 rounded-md">
      <button onClick={() => onTrendChange(p => p + 1)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-l-md"><ArrowLeft size={16} /></button>
      <button onClick={() => onTrendChange(p => p - 1)} disabled={trendOffset <= 0} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-r-md border-l dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"><ArrowRight size={16} /></button>
    </div>
  );
  return (
    <Card
      title="Category Trend"
      isCollapsed={isCollapsed}
      onToggleCollapse={onToggleCollapse}
      controls={
        <select value={selectedCategory} onChange={(e) => onCategoryChange(e.target.value)} className="p-1 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-700" disabled={categories.length === 0}>
          {categories.map(cat => <option key={cat.name} value={cat.name}>{cat.name}</option>)}
        </select>
      }
      navControls={navControls}
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
            <XAxis dataKey="name" style={{ fontSize: '12px' }} />
            <YAxis tickFormatter={(value) => `${currency}${value}`} style={{ fontSize: '12px' }} />
            <Tooltip formatter={(value) => `${currency}${value.toFixed(2)}`} />
            <Line type="monotone" dataKey="total" stroke={categories.find(c => c.name === selectedCategory)?.color || '#8884d8'} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} name={selectedCategory} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
};


const ExpenseList = ({ expenses, onDelete, currency, categories }) => (
  <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg">
    <h3 className="text-xl font-semibold mb-4 text-gray-700 dark:text-gray-200">Recent Expenses (This Month)</h3>
    <div className="space-y-3 max-h-60 overflow-y-auto">
      {expenses.length > 0 ? expenses.sort((a,b) => b.date - a.date).slice(0, 5).map(expense => (
        <div key={expense.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
          <div className="flex items-center">
            <span className="w-3 h-3 rounded-full mr-4" style={{ backgroundColor: categories.find(c => c.name === expense.category)?.color || '#cccccc' }}></span>
            <div>
              <p className="font-semibold">{expense.category}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">{expense.comment}</p>
            </div>
          </div>
          <div className="flex items-center">
            <div className="text-right mr-4">
              <p className="font-bold text-lg">{currency}{expense.price.toFixed(2)}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500">{expense.date.toLocaleDateString()}</p>
            </div>
            <button onClick={() => onDelete(expense.id)} className="text-red-500 hover:text-red-700 p-2 rounded-full hover:bg-red-100 dark:hover:bg-red-900/50"><Trash2 size={18} /></button>
          </div>
        </div>
      )) : <p className="text-center text-gray-500 dark:text-gray-400 py-8">No expenses recorded for this month.</p>}
    </div>
  </div>
);


const IncomeList = ({ income, onDelete, currency }) => (
  <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg">
    <h3 className="text-xl font-semibold mb-4 text-gray-700 dark:text-gray-200">Recent Income (This Month)</h3>
    <div className="space-y-3 max-h-60 overflow-y-auto">
      {income.length > 0 ? income.sort((a,b) => b.date - a.date).slice(0, 5).map(inc => (
        <div key={inc.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
          <div className="flex items-center">
            <span className="w-3 h-3 rounded-full mr-4 bg-green-500"></span>
            <div>
              <p className="font-semibold">{inc.description}</p>
            </div>
          </div>
          <div className="flex items-center">
            <div className="text-right mr-4">
              <p className="font-bold text-lg text-green-600 dark:text-green-400">{currency}{inc.amount.toFixed(2)}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500">{inc.date.toLocaleDateString()}</p>
            </div>
            <button onClick={() => onDelete(inc.id)} className="text-red-500 hover:text-red-700 p-2 rounded-full hover:bg-red-100 dark:hover:bg-red-900/50"><Trash2 size={18} /></button>
          </div>
        </div>
      )) : <p className="text-center text-gray-500 dark:text-gray-400 py-8">No income recorded for this month.</p>}
    </div>
  </div>
);


const AddExpenseModal = ({ onClose, onAddExpense, categories }) => {
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState(categories.length > 0 ? categories[0].name : '');
  const [comment, setComment] = useState('');
  const [date, setDate] = useState(new Date());


  useEffect(() => {
    if (categories.length > 0 && !categories.some(c => c.name === category)) {
      setCategory(categories[0].name);
    }
  }, [categories, category]);


  const handleSubmit = (e) => {
    e.preventDefault();
    if (!price || isNaN(parseFloat(price)) || !category) return;
    onAddExpense({ price: parseFloat(price), category, comment, date });
  };


  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-2xl w-full max-w-md">
        <h2 className="text-2xl font-bold mb-6">Add New Expense</h2>
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Price</label>
              <input type="number" value={price} onChange={e => setPrice(e.target.value)} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md" placeholder="0.00" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date</label>
              <input type="date" value={toInputDate(date)} onChange={e => setDate(new Date(e.target.value))} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md" required />
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category</label>
            <select value={category} onChange={e => setCategory(e.target.value)} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md" disabled={categories.length === 0}>
              {categories.map(cat => <option key={cat.name} value={cat.name}>{cat.name}</option>)}
            </select>
          </div>
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Comment (Optional)</label>
            <input type="text" value={comment} onChange={e => setComment(e.target.value)} className="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 rounded-md" placeholder="e.g., Weekly groceries" />
          </div>
          <div className="flex justify-end gap-4">
            <button type="button" onClick={onClose} className="py-2 px-4 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500">Cancel</button>
            <button type="submit" className="py-2 px-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Add Expense</button>
          </div>
        </form>
      </div>
    </div>
  );
};


const AddIncomeModal = ({ onClose, onAddIncome }) => {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(new Date());


  const handleSubmit = (e) => {
    e.preventDefault();
    if (!amount || isNaN(parseFloat(amount))) return;
    onAddIncome({ amount: parseFloat(amount), description, date });
  };


  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-2xl w-full max-w-md">
        <h2 className="text-2xl font-bold mb-6">Add New Income</h2>
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount</label>
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="w-full p-2 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600" placeholder="0.00" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date</label>
              <input type="date" value={toInputDate(date)} onChange={e => setDate(new Date(e.target.value))} className="w-full p-2 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600" required />
            </div>
          </div>
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
            <input type="text" value={description} onChange={e => setDescription(e.target.value)} className="w-full p-2 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600" placeholder="e.g., Monthly Salary" required />
          </div>
          <div className="flex justify-end gap-4">
            <button type="button" onClick={onClose} className="py-2 px-4 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500">Cancel</button>
            <button type="submit" className="py-2 px-4 bg-green-600 text-white rounded-lg hover:bg-green-700">Add Income</button>
          </div>
        </form>
      </div>
    </div>
  );
};


const AllTransactionsPage = ({ expenses, income, currency, budgetCategories, onDeleteExpense, onDeleteIncome, onNavigate }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');


  const combinedTransactions = useMemo(() => {
    const expensesWithType = expenses.map(e => ({ ...e, type: 'expense', amount: e.price, description: e.comment }));
    const incomeWithType = income.map(i => ({ ...i, type: 'income' }));
    return [...expensesWithType, ...incomeWithType].sort((a, b) => b.date - a.date);
  }, [expenses, income]);


  const filteredTransactions = useMemo(() => {
    return combinedTransactions.filter(t => {
      const descriptionMatch = (t.description || '').toLowerCase().includes(searchTerm.toLowerCase());
      const categoryMatch = (t.category || '').toLowerCase().includes(searchTerm.toLowerCase());
      const searchTermMatch = searchTerm === '' || descriptionMatch || categoryMatch;


      const typeMatch = filterType === 'all' || t.type === filterType;
      const categoryFilterMatch = filterType !== 'expense' || filterCategory === 'all' || t.category === filterCategory;


      return searchTermMatch && typeMatch && categoryFilterMatch;
    });
  }, [combinedTransactions, searchTerm, filterType, filterCategory]);


  return (
    <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-lg max-w-4xl mx-auto">
      <div className="flex items-center mb-6 pb-4 border-b dark:border-gray-700">
        <button onClick={() => onNavigate('dashboard')} className="mr-4 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"><ArrowLeftCircle size={24} /></button>
        <h2 className="text-2xl font-bold">All Transactions</h2>
      </div>


      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
        <input
          type="text"
          placeholder="Search transactions..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="md:col-span-1 w-full p-2 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600"
        />
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="w-full p-2 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600">
          <option value="all">All Types</option>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
        </select>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} disabled={filterType !== 'expense'} className="w-full p-2 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed">
          <option value="all">All Categories</option>
          {budgetCategories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
        </select>
      </div>


      <div className="space-y-3 max-h-[60vh] overflow-y-auto">
        {filteredTransactions.length > 0 ? filteredTransactions.map(t => (
          <div key={t.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
            <div className="flex items-center">
              <span
                className={`w-3 h-3 rounded-full mr-4 ${t.type === 'income' ? 'bg-green-500' : ''}`}
                style={t.type === 'expense' ? { backgroundColor: budgetCategories.find(c => c.name === t.category)?.color || '#cccccc' } : {}}
              ></span>
              <div>
                <p className="font-semibold">{t.type === 'expense' ? t.category : t.description}</p>
                {t.type === 'expense' && <p className="text-sm text-gray-500 dark:text-gray-400">{t.description}</p>}
              </div>
            </div>
            <div className="flex items-center">
              <div className="text-right mr-4">
                <p className={`font-bold text-lg ${t.type === 'income' ? 'text-green-600 dark:text-green-400' : ''}`}>{currency}{t.amount.toFixed(2)}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">{t.date.toLocaleDateString()}</p>
              </div>
              <button onClick={() => t.type === 'income' ? onDeleteIncome(t.id) : onDeleteExpense(t.id)} className="text-red-500 hover:text-red-700 p-2 rounded-full hover:bg-red-100 dark:hover:bg-red-900/50"><Trash2 size={18} /></button>
            </div>
          </div>
        )) : <p className="text-center text-gray-500 dark:text-gray-400 py-8">No matching transactions found.</p>}
      </div>
    </div>
  );
};


const SettingsPage = ({
  onNavigate, activeBudget, onBudgetRecurrenceToggle, onUpdateBudgetLimit, recurringTransactions,
  onAddRecurringTransaction, onDeleteRecurringTransaction, budgetCategories, onAddCategory, onDeleteCategory,
  userCurrencies, currentCurrency, onCurrencyChange, onAddCurrency, onDeleteCurrency, theme, onThemeChange,
  visibleCards, onVisibilityChange, onExport, onImportClick
}) => {
  const [limit, setLimit] = useState(activeBudget?.limit || '');


  useEffect(() => {
    setLimit(activeBudget?.limit || '');
  }, [activeBudget]);


  const handleLimitSave = () => {
    const newLimit = parseFloat(limit);
    if(!isNaN(newLimit) && newLimit > 0) {
      onUpdateBudgetLimit(newLimit);
    } else {
      onUpdateBudgetLimit(null);
    }
  };


  return (
    <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-lg max-w-2xl mx-auto">
      <div className="flex items-center mb-6 pb-4 border-b dark:border-gray-700">
        <button onClick={() => onNavigate('dashboard')} className="mr-4 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"><ArrowLeftCircle size={24} /></button>
        <h2 className="text-2xl font-bold">Settings</h2>
      </div>


      <SettingsSection title="Budget Goal">
        <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-md">
          <Target size={20} className="text-indigo-600 dark:text-indigo-400" />
          <span className="font-medium flex-grow">Set monthly spending limit for '{activeBudget?.name}'</span>
          <input type="number" value={limit} onChange={e => setLimit(e.target.value)} placeholder="No Limit" className="w-32 p-1 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-right" />
          <button onClick={handleLimitSave} className="py-1 px-3 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700">Save</button>
        </div>
      </SettingsSection>


      <SettingsSection title="Recurring Transactions">
        <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-md mb-4">
          <span className="font-medium">Enable for '{activeBudget?.name}'</span>
          <ToggleSwitch isEnabled={activeBudget?.recurringEnabled || false} onToggle={onBudgetRecurrenceToggle} />
        </div>
        {activeBudget?.recurringEnabled && (
          <RecurringTransactionsManager
            transactions={recurringTransactions}
            categories={budgetCategories}
            onAdd={onAddRecurringTransaction}
            onDelete={onDeleteRecurringTransaction}
          />
        )}
      </SettingsSection>


      <SettingsSection title="Appearance">
        <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-md">
          <span className="font-medium">Dark Mode</span>
          <button onClick={() => onThemeChange(theme === 'light' ? 'dark' : 'light')} className="p-2 rounded-full bg-gray-200 dark:bg-gray-600">
            {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
          </button>
        </div>
      </SettingsSection>


      <SettingsSection title="Manage Currencies">
        <CurrencyManager userCurrencies={userCurrencies} currentCurrency={currentCurrency} onCurrencyChange={onCurrencyChange} onAddCurrency={onAddCurrency} onDeleteCurrency={onDeleteCurrency} />
      </SettingsSection>


      <SettingsSection title="Dashboard Tiles">
        <DashboardTilesManager visibleCards={visibleCards} onVisibilityChange={onVisibilityChange} />
      </SettingsSection>


      <SettingsSection title="Manage Categories (for current budget)">
        <CategoryManager categories={budgetCategories} onAddCategory={onAddCategory} onDeleteCategory={onDeleteCategory} />
      </SettingsSection>


      <SettingsSection title="Data Management">
        <div className="flex gap-4">
          <button onClick={onImportClick} className="flex-1 flex items-center justify-center gap-2 p-3 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-200 rounded-md hover:bg-indigo-200 dark:hover:bg-indigo-900"><Upload size={18}/>Import from CSV</button>
          <button onClick={onExport} className="flex-1 flex items-center justify-center gap-2 p-3 bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-200 rounded-md hover:bg-green-200 dark:hover:bg-green-900"><Download size={18}/>Export to CSV</button>
        </div>
      </SettingsSection>
    </div>
  );
};


const SettingsSection = ({ title, children }) => (
  <div className="mb-8">
    <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4 border-b pb-2 dark:border-gray-700">{title}</h3>
    {children}
  </div>
);


const RecurringTransactionsManager = ({ transactions, categories, onAdd, onDelete }) => {
  const [type, setType] = useState('expense');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(categories.length > 0 ? categories[0].name : '');
  const [frequency, setFrequency] = useState('monthly');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);


  const handleAdd = () => {
    if (!amount || isNaN(parseFloat(amount))) return;
    const seed = new Date(startDate);
    const newRT = {
      type,
      amount: parseFloat(amount),
      description,
      frequency,
      startDate: seed,
      // Sentinel: one day before start date.
      lastProcessedDate: new Date(seed.getTime() - 86400000),
    };
    if (type === 'expense') {
      if (!category) return alert('Please select a category for the expense.');
      newRT.category = category;
    }
    onAdd(newRT);
    setAmount('');
    setDescription('');
  };


  return (
    <div>
      <div className="space-y-2 mb-4">
        {transactions.map(rt => (
          <div key={rt.id} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700/50 rounded-md text-sm">
            <div className="flex items-center gap-2">
              <Repeat size={16} className={rt.type === 'expense' ? 'text-red-500' : 'text-green-500'} />
              <div>
                <p className="font-semibold">{rt.description}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {rt.amount} {rt.type === 'expense' ? `(${rt.category})` : ''} - {rt.frequency}
                </p>
              </div>
            </div>
            <button onClick={() => onDelete(rt.id)} className="p-1 rounded-full text-red-500 hover:bg-red-100 dark:hover:bg-red-900/50"><Trash2 size={16}/></button>
          </div>
        ))}
        {transactions.length === 0 && <p className="text-center text-sm text-gray-500 dark:text-gray-400 py-2">No recurring transactions set up.</p>}
      </div>
      <div className="p-3 border-t dark:border-gray-700 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <select value={type} onChange={e => setType(e.target.value)} className="w-full p-2 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600">
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount" className="w-full p-2 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600"/>
        </div>
        <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (e.g., Netflix)" className="w-full p-2 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600"/>
        {type === 'expense' && (
          <select value={category} onChange={e => setCategory(e.target.value)} className="w-full p-2 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600" disabled={categories.length === 0}>
            {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        )}
        <div className="grid grid-cols-2 gap-2">
          <select value={frequency} onChange={e => setFrequency(e.target.value)} className="w-full p-2 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full p-2 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600"/>
        </div>
        <button onClick={handleAdd} className="w-full p-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">Add Recurring Transaction</button>
      </div>
    </div>
  );
};


const ToggleSwitch = ({ isEnabled, onToggle }) => (
  <label className="relative inline-flex items-center cursor-pointer">
    <input type="checkbox" checked={isEnabled} onChange={(e) => onToggle(e.target.checked)} className="sr-only peer" />
    <div className="w-11 h-6 bg-gray-200 dark:bg-gray-600 rounded-full peer peer-focus:ring-4 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-800 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
  </label>
);


const CurrencyManager = ({ userCurrencies, currentCurrency, onCurrencyChange, onAddCurrency, onDeleteCurrency }) => {
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');


  const handleAdd = () => {
    if (!name.trim() || !symbol.trim()) return;
    onAddCurrency({ name: name.trim(), symbol: symbol.trim() });
    setName('');
    setSymbol('');
  };


  return (
    <div>
      <div className="space-y-2 mb-4">
        {userCurrencies.map(c => (
          <div key={c.id} className={`flex items-center justify-between p-2 rounded-md cursor-pointer ${currentCurrency === c.symbol ? 'bg-indigo-100 dark:bg-indigo-900/50' : 'bg-gray-50 dark:bg-gray-700/50'}`} onClick={() => onCurrencyChange(c.symbol)}>
            <div className="flex items-center">
              {currentCurrency === c.symbol ? <CheckCircle size={16} className="mr-3 text-indigo-600" /> : <div className="w-4 h-4 mr-3"></div>}
              <span>{c.name} ({c.symbol})</span>
            </div>
            <button onClick={(e) => { e.stopPropagation(); onDeleteCurrency(c.id); }} className="text-red-500 hover:text-red-700 p-1 rounded-full hover:bg-red-100 dark:hover:bg-red-900/50"><Trash2 size={16} /></button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 p-2 border-t dark:border-gray-700 pt-4">
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Currency Name" className="w-1/2 p-2 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
        <input type="text" value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="Symbol" className="w-1/4 p-2 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
        <button onClick={handleAdd} className="flex-grow p-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">Add</button>
      </div>
    </div>
  );
};


const DashboardTilesManager = ({ visibleCards, onVisibilityChange }) => {
  const TILE_NAMES = { budgetProgress: 'Budget Progress', incomeVsExpense: 'Income vs. Expense', pie: 'Expenses by Category', bar: 'Monthly Totals', trend: 'Category Trend' };
  return (
    <div className="space-y-3">
      {Object.keys(TILE_NAMES).map(key => (
        <div key={key} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-md">
          <span className="font-medium">{TILE_NAMES[key]}</span>
          <ToggleSwitch isEnabled={visibleCards[key] !== false} onToggle={(v) => onVisibilityChange(key, v)} />
        </div>
      ))}
    </div>
  );
};


const CategoryManager = ({ categories, onAddCategory, onDeleteCategory }) => {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#8884d8');


  const handleAdd = () => {
    if (!name.trim()) return;
    onAddCategory({ name: name.trim(), color });
    setName('');
    setColor('#8884d8');
  };


  return (
    <div>
      <div className="space-y-2 mb-4">
        {categories.map(cat => (
          <div key={cat.id} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700/50 rounded-md">
            <div className="flex items-center">
              <span className="w-5 h-5 rounded-full mr-3" style={{ backgroundColor: cat.color }}></span>
              <span>{cat.name}</span>
            </div>
            <button onClick={() => onDeleteCategory(cat.id, cat.name)} className="text-red-500 hover:text-red-700 p-1 rounded-full hover:bg-red-100 dark:hover:bg-red-900/50"><Trash2 size={16} /></button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 p-2 border-t dark:border-gray-700 pt-4">
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="New category name" className="flex-grow p-2 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
        <input type="color" value={color} onChange={e => setColor(e.target.value)} className="p-1 h-10 w-10 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
        <button onClick={handleAdd} className="p-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700">Add</button>
      </div>
    </div>
  );
};


const BudgetModal = ({ budgets, activeBudgetId, onSelect, onCreate, onClose }) => {
  const [newBudgetName, setNewBudgetName] = useState('');


  const handleCreate = () => {
    onCreate(newBudgetName);
    setNewBudgetName('');
  };


  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4">Manage Budgets</h2>
        <div className="space-y-2 mb-4 max-h-60 overflow-y-auto">
          {budgets.map(budget => (
            <button key={budget.id} onClick={() => { onSelect(budget.id); onClose(); }} className={`w-full text-left flex items-center justify-between p-3 rounded-md transition-colors ${budget.id === activeBudgetId ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-800 dark:text-indigo-200' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
              <span>{budget.name}</span>
              {budget.id === activeBudgetId && <CheckCircle size={20} className="text-indigo-600" />}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t dark:border-gray-700 pt-4">
          <input type="text" value={newBudgetName} onChange={e => setNewBudgetName(e.target.value)} placeholder="New budget name" className="flex-grow p-2 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600" />
          <button onClick={handleCreate} className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Create</button>
        </div>
      </div>
    </div>
  );
};


const ImportModal = ({ budgets, onImport, onClose, dataCount }) => {
  const [importOption, setImportOption] = useState('existing');
  const [selectedBudgetId, setSelectedBudgetId] = useState(budgets.length > 0 ? budgets[0].id : '');
  const [newBudgetName, setNewBudgetName] = useState('');


  const handleSubmit = () => {
    if (importOption === 'existing' && selectedBudgetId) {
      onImport(selectedBudgetId, null);
    } else if (importOption === 'new' && newBudgetName.trim()) {
      onImport(null, newBudgetName.trim());
    } else {
      alert("Please select a valid option.");
    }
  };


  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h2 className="text-2xl font-bold mb-4">Import Expenses</h2>
        <p className="mb-6 text-gray-600 dark:text-gray-300">Found <span className="font-bold text-indigo-600 dark:text-indigo-400">{dataCount}</span> expenses. Where would you like to add them?</p>


        <div className="space-y-4">
          <div>
            <label className="flex items-center p-4 border dark:border-gray-600 rounded-lg cursor-pointer">
              <input type="radio" name="import-option" value="existing" checked={importOption === 'existing'} onChange={() => setImportOption('existing')} className="mr-3" />
              <div>
                <span className="font-semibold">Add to existing budget</span>
                <select disabled={importOption !== 'existing'} value={selectedBudgetId} onChange={e => setSelectedBudgetId(e.target.value)} className="w-full mt-2 p-2 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 disabled:opacity-50">
                  {budgets.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            </label>
          </div>
          <div>
            <label className="flex items-center p-4 border dark:border-gray-600 rounded-lg cursor-pointer">
              <input type="radio" name="import-option" value="new" checked={importOption === 'new'} onChange={() => setImportOption('new')} className="mr-3" />
              <div>
                <span className="font-semibold">Create a new budget</span>
                <input type="text" disabled={importOption !== 'new'} value={newBudgetName} onChange={e => setNewBudgetName(e.target.value)} placeholder="New budget name" className="w-full mt-2 p-2 border rounded-md bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 disabled:opacity-50" />
              </div>
            </label>
          </div>
        </div>


        <div className="flex justify-end gap-4 mt-8">
          <button type="button" onClick={onClose} className="py-2 px-4 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500">Cancel</button>
          <button onClick={handleSubmit} className="py-2 px-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Import</button>
        </div>
      </div>
    </div>
  );
};





