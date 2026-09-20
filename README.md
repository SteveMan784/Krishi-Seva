# Krishi Seva (कृषि सेवा) - Intelligent Mandi Queue, Slot Booking & MSP Procurement Optimization
### Smart India Hackathon (SIH) — Problem Statement ID: 26032

> **Jai Jawan, Jai Kisan, Jai Vigyan, Jai Anusandhan**

A comprehensive, production-grade, responsive web application engineered to eliminate predatory mandi middlemen, prevent multi-day truck gridlocks at APMC yards, optimize MSP procurement workflows, provide AI-driven queue latency predictions, and ensure transparent Direct Benefit Transfer (DBT) payouts to farmers.

\\\
START ➔ SELECT LANGUAGE (12 Regional) ➔ LOGIN / REGISTER (Farmer / Staff / Admin)
  ➔ FARMER: Enter Name, Mobile, State, District, Mandi
  ➔ AI ETA ENGINE: Probable Waiting Time & Mandi Traffic Broadcast
  ➔ SELECT SHIFT (Operational 4-Shift Intake) ➔ BOOK SLOT
       ├─ Full ➔ Waiting List Priority Queue
       └─ Confirmed ➔ Scannable QR Gate Pass + SMS Dispatch
  ➔ STAFF TERMINAL (Region-Locked to Matching Center)
       ➔ Gate Scanner ➔ Weighbridge Gross/Tare ➔ AGMARKNET Quality Lab
       ➔ Instant DBT Payout (Paid/Pending/Retry) ➔ Print APMC Receipt
  ➔ ADMIN PORTAL
       ➔ Live Mandi Traffic Declaration (Green/Yellow/Red)
       ➔ Capacity Overrides, Procurement Analytics & Audit Logs
\\\

---

## 🚀 How to Run

### Method 1: Instant Direct Launch (No build dependencies needed)
Launch directly in Microsoft Edge or any modern browser:
```powershell
Start-Process "C:\Users\user\.gemini\antigravity\scratch\krishi-procure\index.html"
```

### Method 2: Local HTTP Server via PowerShell
Run the included launcher script:
```powershell
cd C:\Users\user\.gemini\antigravity\scratch\krishi-procure
powershell -ExecutionPolicy Bypass -File .\run_server.ps1
```
This serves the application on \http://localhost:8080\ and opens Microsoft Edge automatically.

---

## 🌟 Core Features Implemented (SIH 26032)

1. **National Slogan & Clean Official Interface**:
   - Prominent Indian Tricolour header slogan: *Jai Jawan, Jai Kisan, Jai Vigyan, Jai Anusandhan* (Saffron \#FF9933\, White \#FFFFFF\ with Ashoka Chakra, Green \#138808\).
   - Clean, formal Government of India / APMC design system with SVG icons (zero informal emojis).

2. **Custom Farmer Name Input & Propagation**:
   - In the Farmer Login/Registration screen, the user types the Farmer Name (\armer-login-name\), mobile, state, district, and mandi.
   - The typed name dynamically propagates across the farmer dashboard, QR gate pass, live queue tracker, weighbridge desk, and DBT receipt.

3. **Strict Region & Mandi Synchronization**:
   - The Staff portal strictly filters the queue by the staff member's assigned region/mandi: \	okens.filter(tk => tk.centreName === staff.center)\.
   - Only farmers who registered and booked slots for that *exact same region and Mandi* appear in the staff queue.

4. **Probable AI Waiting Time Engine**:
   - Predictive algorithm calculating turnaround latency based on vehicles ahead in queue, weighbridge throughput (8 min/trolley), quality lab testing (5 min), and road congestion.
   - Displays real-time estimated turn time, vehicles ahead, and AI confidence score (90%+).

5. **Admin Mandi Traffic Declaration & Live Advisory**:
   - Administrators can declare real-time road and gate congestion levels:
     - 🟢 **Smooth Flow** (Gates open, no road delay)
     - 🟡 **Moderate Queue** (+15–30 min congestion)
     - 🔴 **Heavy Congestion** (+45–90 min congestion)
   - Live broadcast alerts appear instantly on farmer dashboards.

6. **Simple SMS Dispatch Option**:
   - Direct SMS dispatch modal sending TRAI-compliant SMS notifications to the farmer's mobile phone and the slot booking center.

7. **All-India MSP Centers from Official PDF**:
   - Hierarchical data (State ➔ District ➔ Primary Mandis/Yards) extracted across 28+ States and UTs from official procurement directories.

8. **12 Regional Indian Languages with Web Speech Read-Aloud**:
   - English, Hindi, Kannada, Malayalam, Tamil, Telugu, Marathi, Punjabi, Bengali, Gujarati, Odia, and Assamese.
   - Native voice read-aloud for accessibility across rural communities.

9. **4 Realistic Mandi Operational Shifts**:
   - Shift 1: Early Morning Heavy Intake (07:00 AM – 10:00 AM)
   - Shift 2: Standard Morning Weighbridge (10:00 AM – 01:00 PM)
   - Shift 3: Afternoon Quality & Grading (01:30 PM – 04:30 PM)
   - Shift 4: Evening Clearance & Payout (04:30 PM – 07:00 PM)

10. **Procurement Lifecycle Operations**:
    - Embedded offline QR engine (\js/qr_engine.js\) generating scannable QR passes.
    - Weighbridge gross/tare/net calculation.
    - AGMARKNET quality grading (Grade A / B / C / Rejection).
    - Direct Benefit Transfer (DBT) simulation with Bank UTR generation.
    - Print-ready official APMC procurement slip.
