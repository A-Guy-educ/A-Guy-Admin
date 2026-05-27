/**
 * Purchase Receipt Email Template — English
 *
 * @fileType email-template
 * @domain email
 * @pattern purchase-receipt
 * @ai-summary English purchase receipt email sent to users after successful payment
 */

import React from 'react'

export interface PurchaseReceiptData {
  productName: string
  amount: number
  currency: string
  transactionId: string
  paymentDate: string
  purchaseLink: string
  couponCode?: string
  couponDiscount?: string
  originalAmount?: number
}

function formatAmount(amount: number, currency: string): string {
  const symbols: Record<string, string> = { ILS: '₪', USD: '$', EUR: '€' }
  const symbol = symbols[currency] ?? currency
  const formatted = (amount / 100).toFixed(2)
  return `${symbol}${formatted}`
}

/**
 * English purchase receipt email body.
 * Renders as a standalone HTML document compatible with all major email clients.
 */
export function PurchaseReceiptEmailEN({
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
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Purchase Confirmation — {productName}</title>
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
                      Purchase Confirmed!
                    </h1>
                    <p style={{ margin: '8px 0 0', color: '#dbeafe', fontSize: '14px' }}>
                      Thank you for your purchase
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
                            Transaction ID
                          </td>
                          <td
                            style={{
                              padding: '12px 0',
                              borderBottom: '1px solid #e5e7eb',
                              color: '#111827',
                              fontSize: '14px',
                              textAlign: 'right',
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
                            Payment Date
                          </td>
                          <td
                            style={{
                              padding: '12px 0',
                              borderBottom: '1px solid #e5e7eb',
                              color: '#111827',
                              fontSize: '14px',
                              textAlign: 'right',
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
                              Original Amount
                            </td>
                            <td
                              style={{
                                padding: '12px 0',
                                borderBottom: '1px solid #e5e7eb',
                                color: '#9ca3af',
                                fontSize: '14px',
                                textAlign: 'right',
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
                              Coupon Applied
                            </td>
                            <td
                              style={{
                                padding: '12px 0',
                                borderBottom: '1px solid #e5e7eb',
                                color: '#111827',
                                fontSize: '14px',
                                textAlign: 'right',
                              }}
                            >
                              {couponCode}
                              {couponDiscount && (
                                <span
                                  style={{
                                    color: '#16a34a',
                                    marginLeft: '8px',
                                    fontWeight: 'bold',
                                  }}
                                >
                                  ({couponDiscount} off)
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
                            Amount Paid
                          </td>
                          <td
                            style={{
                              padding: '12px 0',
                              color: '#111827',
                              fontSize: '20px',
                              fontWeight: 'bold',
                              textAlign: 'right',
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
                            View My Purchases
                          </a>
                        </td>
                      </tr>
                    </table>

                    {/* Footer note */}
                    <p
                      style={{ margin: '0', color: '#9ca3af', fontSize: '12px', lineHeight: '1.6' }}
                    >
                      If you have any questions about your purchase, please contact our support
                      team. This email confirms a successful payment. No action is required on your
                      part.
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
                      A-Guy — Your Digital Math Teacher
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
