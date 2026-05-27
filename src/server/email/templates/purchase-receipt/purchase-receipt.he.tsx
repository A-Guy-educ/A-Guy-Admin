/**
 * Purchase Receipt Email Template — Hebrew
 *
 * @fileType email-template
 * @domain email
 * @pattern purchase-receipt
 * @ai-summary Hebrew purchase receipt email sent to users after successful payment
 */

import React from 'react'

import type { PurchaseReceiptData } from './purchase-receipt.en'

function formatAmount(amount: number, currency: string): string {
  const symbols: Record<string, string> = { ILS: '₪', USD: '$', EUR: '€' }
  const symbol = symbols[currency] ?? currency
  const formatted = (amount / 100).toFixed(2)
  return `${formatted}${symbol}`
}

/**
 * Hebrew purchase receipt email body.
 * Renders as a standalone HTML document compatible with all major email clients.
 */
export function PurchaseReceiptEmailHE({
  data,
}: {
  data: PurchaseReceiptData
}): React.ReactElement {
  const {
    productName,
    amount,
    currency,
    transactionId,
    paymentDate,
    purchaseLink,
    couponCode,
    couponDiscount,
    originalAmount,
  } = data

  return (
    <html lang="he" dir="rtl">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>אישור רכישה — {productName}</title>
      </head>
      <body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: '#f5f5f5',
          fontFamily: 'Arial, sans-serif',
        }}
      >
        <table
          width="100%"
          cellPadding="0"
          cellSpacing="0"
          style={{ backgroundColor: '#f5f5f5', padding: '32px 16px' }}
        >
          <tr>
            <td align="center">
              <table
                width="600"
                cellPadding="0"
                cellSpacing="0"
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                }}
              >
                {/* Header */}
                <tr>
                  <td
                    style={{
                      backgroundColor: '#2563eb',
                      padding: '32px 40px',
                      textAlign: 'center',
                    }}
                  >
                    <h1
                      style={{ margin: 0, color: '#ffffff', fontSize: '24px', fontWeight: 'bold' }}
                    >
                      הרכישה אושרה!
                    </h1>
                    <p style={{ margin: '8px 0 0', color: '#dbeafe', fontSize: '14px' }}>
                      תודה על הרכישה
                    </p>
                  </td>
                </tr>

                {/* Body */}
                <tr>
                  <td style={{ padding: '40px' }}>
                    {/* Product */}
                    <h2
                      style={{
                        margin: '0 0 24px',
                        color: '#111827',
                        fontSize: '20px',
                        fontWeight: 'bold',
                      }}
                    >
                      {productName}
                    </h2>

                    {/* Receipt details table */}
                    <table
                      width="100%"
                      cellPadding="0"
                      cellSpacing="0"
                      style={{ marginBottom: '24px' }}
                    >
                      <tbody>
                        <tr>
                          <td
                            style={{
                              padding: '12px 0',
                              borderBottom: '1px solid #e5e7eb',
                              color: '#6b7280',
                              fontSize: '14px',
                            }}
                          >
                            מספר עסקה
                          </td>
                          <td
                            style={{
                              padding: '12px 0',
                              borderBottom: '1px solid #e5e7eb',
                              color: '#111827',
                              fontSize: '14px',
                              textAlign: 'left',
                              fontFamily: 'monospace',
                            }}
                          >
                            {transactionId}
                          </td>
                        </tr>
                        <tr>
                          <td
                            style={{
                              padding: '12px 0',
                              borderBottom: '1px solid #e5e7eb',
                              color: '#6b7280',
                              fontSize: '14px',
                            }}
                          >
                            תאריך התשלום
                          </td>
                          <td
                            style={{
                              padding: '12px 0',
                              borderBottom: '1px solid #e5e7eb',
                              color: '#111827',
                              fontSize: '14px',
                              textAlign: 'left',
                            }}
                          >
                            {paymentDate}
                          </td>
                        </tr>
                        {originalAmount !== undefined && (
                          <tr>
                            <td
                              style={{
                                padding: '12px 0',
                                borderBottom: '1px solid #e5e7eb',
                                color: '#6b7280',
                                fontSize: '14px',
                              }}
                            >
                              סכום מקורי
                            </td>
                            <td
                              style={{
                                padding: '12px 0',
                                borderBottom: '1px solid #e5e7eb',
                                color: '#9ca3af',
                                fontSize: '14px',
                                textAlign: 'left',
                                textDecoration: 'line-through',
                              }}
                            >
                              {formatAmount(originalAmount, currency)}
                            </td>
                          </tr>
                        )}
                        {couponCode && (
                          <tr>
                            <td
                              style={{
                                padding: '12px 0',
                                borderBottom: '1px solid #e5e7eb',
                                color: '#6b7280',
                                fontSize: '14px',
                              }}
                            >
                              קופון שומש
                            </td>
                            <td
                              style={{
                                padding: '12px 0',
                                borderBottom: '1px solid #e5e7eb',
                                color: '#111827',
                                fontSize: '14px',
                                textAlign: 'left',
                              }}
                            >
                              {couponCode}
                              {couponDiscount && (
                                <span
                                  style={{
                                    color: '#16a34a',
                                    marginRight: '8px',
                                    fontWeight: 'bold',
                                  }}
                                >
                                  ({couponDiscount} הנחה)
                                </span>
                              )}
                            </td>
                          </tr>
                        )}
                        <tr>
                          <td
                            style={{
                              padding: '12px 0',
                              color: '#6b7280',
                              fontSize: '14px',
                              fontWeight: 'bold',
                            }}
                          >
                            סכום ששולם
                          </td>
                          <td
                            style={{
                              padding: '12px 0',
                              color: '#111827',
                              fontSize: '20px',
                              fontWeight: 'bold',
                              textAlign: 'left',
                            }}
                          >
                            {formatAmount(amount, currency)}
                          </td>
                        </tr>
                      </tbody>
                    </table>

                    {/* CTA Button */}
                    <table width="100%" cellPadding="0" cellSpacing="0">
                      <tr>
                        <td align="center" style={{ paddingBottom: '32px' }}>
                          <a
                            href={purchaseLink}
                            style={{
                              display: 'inline-block',
                              backgroundColor: '#2563eb',
                              color: '#ffffff',
                              padding: '14px 32px',
                              borderRadius: '6px',
                              textDecoration: 'none',
                              fontWeight: 'bold',
                              fontSize: '14px',
                            }}
                          >
                            הרכישות שלי
                          </a>
                        </td>
                      </tr>
                    </table>

                    {/* Footer note */}
                    <p
                      style={{ margin: '0', color: '#9ca3af', fontSize: '12px', lineHeight: '1.6' }}
                    >
                      אם יש לך שאלות לגבי הרכישה, אנא פנה לצוות התמיכה שלנו. דוא&quot;ל זה מאשר
                      תשלום מוצלח. לא נדרשת פעולה מצדך.
                    </p>
                  </td>
                </tr>

                {/* Footer */}
                <tr>
                  <td
                    style={{
                      backgroundColor: '#f9fafb',
                      padding: '24px 40px',
                      borderTop: '1px solid #e5e7eb',
                    }}
                  >
                    <p
                      style={{ margin: 0, color: '#9ca3af', fontSize: '12px', textAlign: 'center' }}
                    >
                      A-Guy — המורה הדיגיטלי שלך למתמטיקה
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  )
}
