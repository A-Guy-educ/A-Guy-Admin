import { NextRequest, NextResponse } from 'next/server'
import { queryChaptersByGrade } from '@/lib/queries/chapters'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const grade = searchParams.get('grade')

  if (!grade) {
    return NextResponse.json({ error: 'Grade parameter is required' }, { status: 400 })
  }

  try {
    const chapters = await queryChaptersByGrade({ gradeLevel: grade })
    const course = chapters[0]?.course
    const courseSlug =
      typeof course === 'object' && course !== null && 'slug' in course ? course.slug : ''

    return NextResponse.json({
      chapters,
      courseSlug,
    })
  } catch (error) {
    console.error('Error fetching chapters:', error)
    return NextResponse.json({ error: 'Failed to fetch chapters' }, { status: 500 })
  }
}
