import { NextRequest, NextResponse } from 'next/server'
import { enrichPeople } from '@/lib/people-enrichment'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { companyName, ragioneSociale, city, piva, categoria, formaGiuridica, website, teamMembers, personName, personRole, linkedinPerson, linkedinCompany, titolareFromRegistry, titolareCF, titolareDataNascita, titolareSesso, titolareEta } = body

    if (!companyName) {
      return NextResponse.json({ error: 'companyName required' }, { status: 400 })
    }

    const result = await enrichPeople(
      companyName,
      ragioneSociale || null,
      city || '',
      piva || null,
      categoria || null,
      formaGiuridica || null,
      website || '',
      teamMembers || [],
      personName || null,
      personRole || null,
      linkedinPerson || null,
      linkedinCompany || null,
      titolareFromRegistry || null,
      titolareCF || null,
      titolareDataNascita || null,
      titolareSesso || null,
      titolareEta || null,
    )

    return NextResponse.json(result)
  } catch (err: any) {
    console.error('[lead-people] error:', err?.message)
    return NextResponse.json({ persone: [], totale_trovate: 0, fonti: [], raccomandazioni_team: [] })
  }
}
