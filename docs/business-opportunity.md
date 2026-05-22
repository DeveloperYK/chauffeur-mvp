# Chauffeur Company Business Opportunity

## Overview

- Contact's multi-millionaire friend owns chauffeur company
  - Makes £70-100k weekly through exclusive deal with major consultancy (KSG/BSG)
  - Handles thousands of executives
  - Wants to scale to other clients but system too outdated

## Current Workflow (Manual)

- Secretary calls taxi office → operator writes in spreadsheet
- Operators contact driver pool manually via phone/WhatsApp
- Send confirmation message to executive with basic details

## Proposed System Design

### Semi-Automated Approach

Maintaining operator involvement with:
- Jira-style ticketing system for operators
- Driver mobile app with geolocation tracking
- Real-time tracking links sent to executives instead of static messages

### Driver Hierarchy Structure

1. **Premium drivers** (employees, contacted first)
2. **Regular drivers** (employees, backup option)
3. **Backfill drivers** (subcontractors via WhatsApp group)

### Booking Requirements

- All bookings minimum 24 hours advance notice
- No real-time/on-demand requests

## MVP Ticket Workflow States

### Dashboard Phases

1. **Unassigned** - incoming requests
2. **Assigned** - driver accepted via link
3. **In Progress** - auto-triggered 1-2 hours before pickup
4. **Completed** - auto-moved 1 hour after job end
5. **Needs Action** - escalation for issues
6. **Cancelled**

### Driver Acceptance Process

- WhatsApp link with job details
- Simple yes/no response
- Automatic assignment and executive notification

## Revenue & Next Steps

### Potential Revenue

- £10k+ monthly licensing fee potential
- Company currently generates £280-400k monthly
- Multiple similar opportunities through contact's network

### Additional Modernization Needs

- Invoicing system (currently manual spreadsheet calculations)
- Payment processing improvements

### Immediate Actions

- Schedule call with company owner
- Request sample spreadsheet data
- Create UI mockups and user flows
- Address edge cases (late arrivals, extensions, driver issues)
