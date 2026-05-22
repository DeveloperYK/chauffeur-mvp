# MVP Demo & Requirements

## Current MVP Features

### Core Functionality

- Built functional booking system with driver assignment workflow
- Booking creation form with client details, pickup/dropoff locations, timing
- Driver selection with availability filtering and route optimization logic
- Unique driver links for job acceptance (prevents sharing/fraud)
- Automated status progression: Created → Assigned → In Progress → Waiting Driver Form → Done
- Waiting time calculator with client-specific rates (£1/min vs 50p depending on contract)
- Activity tracking and driver utilization dashboard

### Tech Stack

- Next.js
- Vercel deployment
- Neon Postgres DB
- Fallback spreadsheet sync maintained for business continuity

## Business Logic Requirements

### Case Code System

- Each executive/project has unique case code from end client
- Mandatory field - jobs at risk without proper case code
- Need dropdown/autocomplete for known codes

### Driver Categorization and Optimization

- Employee drivers (company cars) get priority for 40-50 hours/week
- Contractors (own vehicles) fill remaining capacity
- Subcontractors via WhatsApp groups for overflow (5-10% of jobs)

### Client-Specific Business Rules

- Different waiting time rates per contract
- Special instructions (e.g., drop off around corner, not at building)
- Preferred driver assignments for repeat clients

### Driver Compliance Tracking

- MOT, driving license, PCO license validation
- Automated renewal reminders vs current manual calendar checks

## Operational Workflow Improvements

### Current State

- 100-200 jobs/day managed via spreadsheet color coding
- Manual driver availability checking across WhatsApp chats
- Route optimization calculations done mentally by operators
- Screenshot-based job history validation

### Proposed Automation Eliminates

- Manual driver availability checking across WhatsApp chats
- Route optimization calculations done mentally by operators
- Screenshot-based job history validation

### System Features

- Multi-operator system with individual accounts and filtering
- Automated SMS system via Twilio replacing individual operator phone numbers

### Location Tracking (Excluded from MVP)

- Live location tracking excluded from MVP (requires mobile app development)
- Alternative: Driver check-in/check-out via web links
- WhatsApp live location integration to explore later

## Next Steps

1. Clean up application and implement SMS messaging system
2. Async delivery of business rules for pricing/invoicing calculations
3. Schedule demo session with actual operators for direct feedback
4. Gather driver database and validation requirements
5. Define roadmap for production deployment and parallel testing period
6. Discuss monetization model and scaling to other chauffeur companies (200+ potential operators in market)
